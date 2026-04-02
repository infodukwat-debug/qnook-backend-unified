const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY);
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

app.post('/create_payment_intent', async (req, res) => {
  const { amount, currency, description, payment_method_types } = req.body;
  if (!amount || !currency) {
    return res.status(400).json({ error: 'Missing amount or currency' });
  }
  try {
    const intent = await stripe.paymentIntents.create({
      amount: parseInt(amount),
      currency: currency,
      payment_method_types: payment_method_types || ['card_present'],
      capture_method: 'automatic',
      description: description || 'Paiement Qnook',
    });
    res.json({ client_secret: intent.client_secret });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

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

// ========== Routes Email ==========
// Configuration SMTP (à configurer avec variables d'environnement)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

app.post('/send_emails', async (req, res) => {
  const {
    email, wantReceipt, wantNotification, productName, durationChosen,
    actualDuration, extraMinutes, totalAmount, currency, paymentIntentId
  } = req.body;

  try {
    if (wantReceipt) {
      const receiptBody = `Merci pour votre utilisation.\n\nProduit: ${productName}\nDurée choisie: ${durationChosen} min\nTemps réel: ${actualDuration} min\nMinutes supplémentaires: ${extraMinutes}\nTotal payé: ${totalAmount} ${currency}\nID paiement: ${paymentIntentId}`;
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: "Votre reçu Qnook",
        text: receiptBody,
      });
    }
    if (wantNotification) {
      const notificationBody = "Votre session Qnook est terminée. Merci de votre visite.";
      await transporter.sendMail({
        from: process.env.FROM_EMAIL,
        to: email,
        subject: "Fin de votre session Qnook",
        text: notificationBody,
      });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== Routes Produits (CRUD) ==========
// Initialiser un fichier products.json s'il n'existe pas
if (!fs.existsSync(productsFile)) {
  fs.writeFileSync(productsFile, JSON.stringify([], null, 2));
}

// GET tous les produits
app.get('/api/products', (req, res) => {
  try {
    const data = fs.readFileSync(productsFile, 'utf8');
    res.json(JSON.parse(data));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST créer un nouveau produit
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

// PUT modifier un produit
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

// DELETE supprimer un produit
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

// Route de test
app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend unifié démarré sur le port ${port}`);
});
