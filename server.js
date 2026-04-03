const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY);
const productsFile = path.join(__dirname, 'products.json');

// ========== Routes Stripe Terminal ==========
app.post('/connection_token', async (req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Création d'un PaymentIntent avec capture automatique (paiement immédiat)
app.post('/create_payment_intent', async (req, res) => {
  const { amount, currency, description, payment_method_types, email } = req.body;
  if (!amount || !currency) return res.status(400).json({ error: 'Missing amount or currency' });
  try {
    const intentParams = {
      amount: parseInt(amount),
      currency,
      payment_method_types: payment_method_types || ['card_present'],
      capture_method: 'automatic', // Paiement immédiat
      description: description || 'Paiement Qnook',
    };
    if (email) intentParams.receipt_email = email;
    const intent = await stripe.paymentIntents.create(intentParams);
    res.json({ client_secret: intent.client_secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Route pour les produits
if (!fs.existsSync(productsFile)) fs.writeFileSync(productsFile, JSON.stringify([], null, 2));
app.get('/api/products', (req, res) => {
  try {
    const data = fs.readFileSync(productsFile, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// (autres routes CRUD inchangées, non recopiées pour la lisibilité, mais à conserver)

app.get('/ping', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => console.log(`Backend unifié démarré sur le port ${port}`));
