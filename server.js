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

const botActiveState = process.env.ALLOWED_GROUP_IDS.split(',').reduce((acc, id) => {
  acc[id.trim()] = true;
  return acc;
}, {});

clientWP.on('qr', (qr) => {
  console.log('qr> ', qr);
  qrcode.generate(qr, { small: true });
});

clientWP.on('authenticated', () => {
  console.log('Auth Completed!');
});

clientWP.on('ready', () => {
  console.log('WhatsAppChatGPT is ready!');
  console.log('On/Off mode available !');
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

  const promptInitial = "Tu es mon assistant de réponse à une conversation WhatsApp. Je m'appelle Christophe Joassin et on me surnomme Jojo. Tu réponds au nom de Jojo-GPT. Dans cette conversation, ce sont des amis proches. Le ton est familier. Il y a souvent des blagues. Je ne veux pas que tu réponds à tous les messages mais seulement lorsque tu penses qu'il y a quelque chose de pertinent à dire. Tu devrais répondre une fois tous les 5 à 10 messages sauf si le message m'est explicitement destiné. Les réponses doivent être courtes. Maximum 150 caractères. Si tu ne réponds pas, la réponse doit être vide.";

  const conversationState = {};

function isEmojiOnly(message) {
  const emojiRegex = /[🌀-🗿😀-🙏🚀-🛿☀-⛿✀-➿🤀-🧿🩰-🫿🀄🃏]/u;
  return Array.from(message).every(char => emojiRegex.test(char));
}

  clientWP.on('message_create', async (msg) => {
    if (typeof msg.author === 'undefined') {
      return;
    }
    const contact = await msg.getContact();
    const contactName = contact.pushname || contact.name || msg.author;
    const message = contactName + (msg.fromMe ? '(me): ' : ': ') + msg.body;
    console.log('MESSAGE RECEIVED from', contactName, ':', message);

    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    if (!conversationState[chatId]) {
      conversationState[chatId] = { messages: [] }; // Initialize conversation state
    }

    // Vérifier si le message contient uniquement un ou plusieurs emojis
    if (isEmojiOnly(msg.body)) {
      console.log("Message ignoré car il s'agit uniquement d'un smiley.");
      return;
    }

    // Ajouter le message à l'historique de la conversation
    conversationState[chatId].messages.push({ role: 'user', content: msg.body });

    // Vérifier si le bot doit être mis en pause ou activé
    if (/jojo-?gpt off/i.test(msg.body)) {
      botActiveState[chatId] = false;
      chat.sendMessage("[Jojo-GPT]: Je ne répondrai plus qu'aux messages qui me sont explicitement adressés.");
      return;
    }

    if (/jojo-?gpt on/i.test(msg.body)) {
      botActiveState[chatId] = true;
      chat.sendMessage('[Jojo-GPT]: Super, je vais me mêler de tout !');
      return;
    }

    const isAddressedToGPT = /jojo-?gpt/i.test(msg.body);
    if (botActiveState[chatId] === false && !isAddressedToGPT) {
      console.log('Bot is currently deactivated for this chat.');
      return;
    }

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
