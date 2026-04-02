const express = require('express');
const cors = require('cors');
const Stripe = require('stripe');
const nodemailer = require('nodemailer');

const app = express();
app.use(cors());
app.use(express.json());

const stripe = Stripe(process.env.STRIPE_TEST_SECRET_KEY);

// Configuration SMTP pour les emails
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

// (Optionnel) capture si vous passez en manuel
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

// ========== Route pour les emails ==========

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

// Route de test
app.get('/ping', (req, res) => {
  res.json({ status: 'ok' });
});

const port = process.env.PORT || 10000;
app.listen(port, '0.0.0.0', () => {
  console.log(`Backend unifié démarré sur le port ${port}`);
});
