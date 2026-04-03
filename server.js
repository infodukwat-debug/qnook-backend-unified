const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');

const app = express();

// ========== Configuration CORS explicite ==========
app.use(cors({
  origin: '*', // En production, remplacez '*' par l'URL de votre frontend
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Initialisation de Stripe avec une version d'API récente (nécessaire pour les autorisations incrémentales)
const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia' // 👈 Version qui supporte request_incremental_authorization_support
});

const productsFile = path.join(__dirname, 'products.json');

// ========== Routes Stripe Terminal ==========
app.post('/connection_token', async (req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Création d'un PaymentIntent avec capture manuelle ET support des autorisations incrémentales
app.post('/create_payment_intent', async (req, res) => {
  const { amount, currency, description, payment_method_types, email } = req.body;
  if (!amount || !currency) {
    return res.status(400).json({ error: 'Missing amount or currency' });
  }
  try {
    const intentParams = {
      amount: parseInt(amount),
      currency: currency,
      payment_method_types: payment_method_types || ['card_present'],
      capture_method: 'manual', // ← Préautorisation
      description: description || 'Paiement Qnook',
      request_incremental_authorization_support: true, // ✅ Permet l'augmentation d'autorisation
    };
    if (email) {
      intentParams.receipt_email = email;
    }
    const intent = await stripe.paymentIntents.create(intentParams);
    res.json({ client_secret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Route pour terminer la session et facturer le temps supplémentaire
app.post('/end-session', async (req, res) => {
  const { paymentIntentId, baseAmount, extraMinutes, pricePerMinute } = req.body;
  if (!paymentIntentId || baseAmount === undefined || extraMinutes === undefined || pricePerMinute === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const extraAmount = extraMinutes * pricePerMinute;
  const totalAmount = baseAmount + extraAmount;

  try {
    // 1. Si dépassement, augmenter l'autorisation
    if (extraAmount > 0) {
      const incrementedIntent = await stripe.paymentIntents.incrementAuthorization(
        paymentIntentId,
        { amount: totalAmount }
      );
      console.log(`✅ Autorisation augmentée : ${totalAmount} centimes (${extraMinutes} min supp.)`);
    }

    // 2. Capturer le paiement (le montant total sera débité)
    const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
    console.log(`✅ Paiement capturé : ${capturedIntent.amount} centimes`);

    res.json({ success: true, totalAmount: totalAmount });
  } catch (err) {
    console.error("Erreur lors de la fin de session :", err);
    res.status(500).json({ error: err.message });
  }
});

// Route de capture simple (conservée pour compatibilité)
app.post('/capture_payment_intent', async (req, res) => {
  const { payment_intent_id } = req.body;
  if (!payment_intent_id) {
    return res.status(400).json({ error: 'Missing payment_intent_id' });
  }
  try {
    const intent = await stripe.paymentIntents.capture(payment_intent_id);
    res.json(intent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes Produits (CRUD) ==========
if (!fs.existsSync(productsFile)) {
  fs.writeFileSync(productsFile, JSON.stringify([], null, 2));
}

app.get('/api/products', (req, res) => {
  try {
    const data = fs.readFileSync(productsFile, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    console.error("Erreur lecture products.json :", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', (req, res) => {
  try {
    const { name, price, image, promo } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ error: 'Missing name or price' });
    }
    const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const newId = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const newProduct = { id: newId, name, price, image: image || '🕐', promo: promo || null };
    products.push(newProduct);
    fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
    res.json(newProduct);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, price, image, promo } = req.body;
    const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const index = products.findIndex(p => p.id === id);
    if (index === -1) return res.status(404).json({ error: 'Product not found' });
    if (name !== undefined) products[index].name = name;
    if (price !== undefined) products[index].price = price;
    if (image !== undefined) products[index].image = image;
    if (promo !== undefined) products[index].promo = promo;
    fs.writeFileSync(productsFile, JSON.stringify(products, null, 2));
    res.json(products[index]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const newProducts = products.filter(p => p.id !== id);
    if (newProducts.length === products.length) {
      return res.status(404).json({ error: 'Product not found' });
    }
    fs.writeFileSync(productsFile, JSON.stringify(newProducts, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend unifié démarré sur le port ${port}`);
});
