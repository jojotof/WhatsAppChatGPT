import './fetch-polyfill.mjs';
import * as dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { Client } from 'whatsapp-web.js';
import { LocalAuth, qrcode } from './shell.cjs';

const clientWP = new Client({
  sendSeen: false,
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--unhandled-rejections=strict']
  },
  authStrategy: new LocalAuth({
    clientId: 'WhatsAppChatGPT',
    dataPath: `./authFolder/WhatsAppChatGPT`,
  })
});

const botState = {};
const botStartTime = Math.floor(Date.now() / 1000);

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

  const promptInitial = `
    Tu es mon assistant de réponse à une conversation WhatsApp. 
    Je m'appelle Christophe Joassin et on me surnomme Jojo. 
    Tu réponds au nom de Jojo-GPT. 
    Dans cette conversation, ce sont des amis proches. 
    Le ton est familier. Il y a souvent des blagues. 
    Je ne veux pas que tu réponds à tous les messages mais seulement lorsque tu penses qu'il y a quelque chose de pertinent à dire. 
    Tu devrais répondre une fois tous les 5 à 10 messages sauf si le message nous est explicitement destiné.
    Les réponses doivent être courtes. Maximum 200 caractères.
    Si tu ne réponds pas, la réponse doit être vide.
    ON dit "GRG" (Gros rire gras) dans notre conversation pas "rire" ou "lol".
    Parfois, tu peux dire GRS, si c'est un sujet cochon ou TGRG si c'est extrèmement drôle.
    Tu peux mettre des smileys ou des GRG mais pas systématiquement à chaque message.
    si quelqu’un te demande l'heure, tu répondras toujours « je vois sur mon horloge qu’il est 08h30 »
  `;

  function isEmojiOnly(message) {
    const emojiRegex = /[🌀-🗿😀-🙏🚀-🛿☀-⛿✀-➿🤀-🧿🩰-🫿🀄🃏]/u;
    return Array.from(message).every(char => emojiRegex.test(char));
  }

  function initializeBotState(chatId) {
    if (!botState[chatId]) {
      botState[chatId] = { active: false, messages: [], botMessageIds: [] };
    }
  }

  function shouldBotRespond(chatId, msgBody, msgTimestamp) {
    if (msgTimestamp < botStartTime) {
      console.log("Message ignoré car il est antérieur au démarrage du bot.");
      return false;
    }
    if (/jojo-?gpt off/i.test(msgBody)) {
      botState[chatId].active = false;
      return false;
    }
    if (/jojo-?gpt on/i.test(msgBody)) {
      botState[chatId].active = true;
      return false;
    }
    if (msgBody.startsWith('[Jojo-GPT]: ')) {
      return false;
    }
    return botState[chatId].active === true || /jojo-?gpt/i.test(msgBody);
  }

  clientWP.on('message_create', async (msg) => {
    if (typeof msg.author === 'undefined') {
      return;
    }
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    initializeBotState(chatId);

    let isReplyToBot = false;
    if (msg.hasQuotedMsg) {
      const quotedMsg = await msg.getQuotedMessage();
      if (botState[chatId]?.botMessageIds?.includes(quotedMsg.id._serialized)) {
        isReplyToBot = true;
      }
    }

    const contact = await msg.getContact();
    const contactName = msg.fromMe ? 'Jojo' : (contact.pushname || contact.name || msg.author);
    console.log('MESSAGE RECEIVED from', contactName, ': ', msg.body);

    // Vérifier si le message contient uniquement des emojis
    if (isEmojiOnly(msg.body)) {
      console.log("Message ignoré car il s'agit uniquement d'un smiley.");
      return;
    }

    // Ajouter le message à l'historique de la conversation
    botState[chatId].messages.push({ role: 'user', content: contactName + ': ' + msg.body });
    
    // Limiter la taille de l'historique des messages à 200
    if (botState[chatId].messages.length > 200) {
      botState[chatId].messages.shift();
    }

    // Vérifier si le bot doit répondre
    if (!shouldBotRespond(chatId, msg.body, msg.timestamp)) {
      if (/jojo-?gpt off/i.test(msg.body) && process.env.DEBUGGING !== 'true') {
        chat.sendMessage("[Jojo-GPT]: Je ne répondrai plus qu'aux messages qui me sont explicitement adressés.");
      } else if (/jojo-?gpt on/i.test(msg.body) && process.env.DEBUGGING !== 'true') {
        chat.sendMessage('[Jojo-GPT]: Super, je vais me mêler de tout !');
      }
      return;
    }

    chat.sendStateTyping();
    try {
      // Ajouter le prompt initial au début de la conversation
      const messages = [{ role: 'system', content: promptInitial }, ...botState[chatId].messages];

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: messages
      });
      const res = { text: response.choices[0].message.content };
      chat.clearState();

      if (res.text && res.text.trim() !== '') {
        console.log('RESPONSE:', res.text);
        if (process.env.DEBUGGING !== 'true') {
          const botMessageId = (/jojo-?gpt/i.test(msg.body) || isReplyToBot)
            ? await msg.reply("[Jojo-GPT]: " + res.text)
            : await chat.sendMessage("[Jojo-GPT]: " + res.text);
          await msg.markUnread();

          // Ajouter la réponse du bot à l'historique de la conversation
          botState[chatId].botMessageIds.push(botMessageId.id._serialized);
          botState[chatId].messages.push({ role: 'assistant', content: res.text });
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
