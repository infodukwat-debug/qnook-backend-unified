const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY);
const productsFile = path.join(__dirname, 'products.json');

// ========== Configuration Nodemailer ==========
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ========== Routes Stripe Terminal ==========
app.post('/connection_token', async (req, res) => {
  try {
    const token = await stripe.terminal.connectionTokens.create();
    res.json({ secret: token.secret });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/create_payment_intent', async (req, res) => {
  const { amount, currency, description, payment_method_types, email } = req.body;
  if (!amount || !currency) return res.status(400).json({ error: 'Missing amount or currency' });
  try {
    const intentParams = {
      amount: parseInt(amount),
      currency,
      payment_method_types: payment_method_types || ['card_present'],
      capture_method: 'manual',
      description: description || 'Paiement Qnook',
      payment_method_options: {
        card_present: {
          request_incremental_authorization_support: true, // indispensable pour incrementAuthorization
        },
      },
    };
    if (email) intentParams.receipt_email = email;
    const intent = await stripe.paymentIntents.create(intentParams);
    res.json({ client_secret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Route pour le rappel ==========
app.post('/send-reminder', async (req, res) => {
  const { email, productName, durationChosen } = req.body;
  if (!email || !productName || durationChosen === undefined) {
    return res.status(400).json({ error: 'Missing fields' });
  }
  try {
    const subject = `Rappel Qnook : votre session se termine dans 5 minutes`;
    const text = `Bonjour,\n\nVotre session de ${durationChosen} minutes choisie pour "${productName}" se terminera dans 5 minutes.\n\nMerci de votre visite !\n\nL'équipe Qnook`;
    await transporter.sendMail({
      from: process.env.FROM_EMAIL,
      to: email,
      subject: subject,
      text: text,
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Erreur envoi rappel:", err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes Produits (CRUD) ==========
if (!fs.existsSync(productsFile)) fs.writeFileSync(productsFile, JSON.stringify([], null, 2));

app.get('/api/products', (req, res) => {
  try {
    const data = fs.readFileSync(productsFile, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', (req, res) => {
  try {
    const { name, price, image, promo } = req.body;
    if (!name || price === undefined) return res.status(400).json({ error: 'Missing name or price' });
    const products = JSON.parse(fs.readFileSync(productsFile, 'utf8'));
    const newId = products.length ? Math.max(...products.map(p => p.id)) + 1 : 1;
    const newProduct = { id: newId, name, price, image: image || '', promo: promo || null };
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
    if (newProducts.length === products.length) return res.status(404).json({ error: 'Product not found' });
    fs.writeFileSync(productsFile, JSON.stringify(newProducts, null, 2));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ========== ROUTES POUR LA GESTION DU TEMPS SUPPLÉMENTAIRE ==========

app.post('/increment-authorization', async (req, res) => {
  const { paymentIntentId, newAmount } = req.body;
  if (!paymentIntentId || !newAmount) {
    return res.status(400).json({ error: 'Missing paymentIntentId or newAmount' });
  }
  try {
    const incrementedIntent = await stripe.paymentIntents.incrementAuthorization(
      paymentIntentId,
      { amount: newAmount }
    );
    res.json({ success: true, paymentIntent: incrementedIntent });
  } catch (err) {
    console.error("Erreur lors de l'incrémentation:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/capture-payment', async (req, res) => {
  const { paymentIntentId } = req.body;
  if (!paymentIntentId) {
    return res.status(400).json({ error: 'Missing paymentIntentId' });
  }
  try {
    const capturedIntent = await stripe.paymentIntents.capture(paymentIntentId);
    res.json({ success: true, paymentIntent: capturedIntent });
  } catch (err) {
    console.error("Erreur lors de la capture:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/ping', (req, res) => res.json({ status: 'ok' }));

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => console.log(`Backend unifié démarré sur le port ${port}`));
