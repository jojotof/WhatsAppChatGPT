import './fetch-polyfill.mjs';
import * as dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { Client } from 'whatsapp-web.js';
import { LocalAuth, qrcode } from './shell.cjs';

const clientWP = new Client({
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--unhandled-rejections=strict']
  },
  authStrategy: new LocalAuth({
    clientId: 'WhatsAppChatGPT',
    dataPath: `./authFolder/WhatsAppChatGPT`,
  })
});

clientWP.on('qr', (qr) => {
  console.log('qr> ', qr);
  qrcode.generate(qr, { small: true });
});

clientWP.on('authenticated', () => {
  console.log('Auth Completed!');
});

clientWP.on('ready', () => {
  console.log('WhatsAppChatGPT is ready!');
});

clientWP.on('auth_failure', (msg) => {
  console.error('Auth FAILURE', msg);
});

clientWP.initialize();
console.log('Client initialized and listening for messages');

(async () => {
  const openai = new OpenAI({
    apiKey: process.env.OPENAPI_KEY
  });

  const promptInitial = "Tu es mon assistant de réponse à une conversation WhatsApp. Je m'appelle Christophe Joassin et on me surnomme Jojo. Tu réponds au nom de Jojo-GPT. Dans cette conversation, ce sont des amis proches. Le ton est familier. Il y a souvent des blagues. Je ne veux pas que tu réponde à tous les messages mais seulement lorsque tu pense qu'il y a quelque chose de pertinent à dire. Tu devrais répondre une fois tous les 5 à 10 messages sauf si le message m'est explicitement destiné. Les réponses doivent être courtes. Maximum 150 caractères. Si tu ne répond pas, la réponse doit être vide.";

  const conversationState = {};

  clientWP.on('message_create', async (msg) => {
    if (typeof msg.author === 'undefined') {
      return;
    }
    const message = msg.author + (msg.fromMe ? '(me): ' : ': ') + msg.body;
    console.log('MESSAGE RECEIVED', message);

    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    // Limiter les réponses uniquement au groupe autorisé
    const allowedGroupIds = process.env.ALLOWED_GROUP_IDS.split(',').map(id => id.trim());
    if (!allowedGroupIds.includes(chatId)) {
      console.log(`Message reçu d'un groupe non autorisé: Chat ID: ${chatId}, Name: ${chat.name}`);
      if (process.env.DEBUGING !== 'true') {
        return;
      }
    }

    if (!conversationState[chatId]) {
      conversationState[chatId] = { messages: [] }; // Initialize conversation state
    }

    // Ajouter le message à l'historique de la conversation
    conversationState[chatId].messages.push({ role: 'user', content: msg.body });

    chat.sendStateTyping();
    try {
      // Ajouter le prompt initial au début de la conversation
      const messages = [{ role: 'system', content: promptInitial }, ...conversationState[chatId].messages];

      const response = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages
      });
      const res = { text: response.choices[0].message.content };
      chat.clearState();

      if (res.text && res.text.trim() !== '') {
        console.log('RESPONSE:', res.text);
        if (process.env.DEBUGING !== 'true') {
          const isAddressedToGPT = msg.body.toLowerCase().includes('jojo-gpt');
          if (isAddressedToGPT) {
            msg.reply("[Jojo-GPT]: " + res.text);
          }
          else {
            chat.sendMessage("[Jojo-GPT]: " + res.text);
            return;
          }
          
          // Ajouter la réponse du bot à l'historique de la conversation
          conversationState[chatId].messages.push({ role: 'assistant', content: res.text });
        } else {
          console.log('DEBUG MODE: Message not sent');
        }
      } else {
        console.log('No response generated.');
      }
    } catch (error) {
      console.error('Error:', error);
    }
  });
})();
