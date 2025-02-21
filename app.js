const dotenv = require("dotenv");
const axios = require("axios");
const { createBot, createProvider, createFlow, addKeyword, EVENTS } = require('@bot-whatsapp/bot')
const QRPortalWeb = require('@bot-whatsapp/portal')
const BaileysProvider = require('@bot-whatsapp/provider/baileys')
const MockAdapter = require('@bot-whatsapp/database/mock')
const ServerHttp = require("./src/http");
const fs = require('fs');
const path = require('path');

// Carga las variables de entorno
dotenv.config({ path: "./.env" });

const sendToGeminiAi = async (data) => {
    try {
        const response = await axios.post("http://192.168.0.33:3005/geminiAi", data);
        
        if (response.data.response) {
            console.log("Respuesta de Gemini AI:", response.data.response);
            return response.data.response;
        } else if (response.data.caption) {
            console.log("Respuesta de Gemini AI (Imagen):", response.data.caption);
            return response.data.caption;
        }

        return "No se recibió una respuesta válida de Gemini AI.";
    } catch (error) {
        console.error("Error al enviar datos a Gemini AI:", error.message);
        return "Hubo un error al procesar tu solicitud.";
    }
};

const flowPrincipal = addKeyword(EVENTS.WELCOME)
    .addAction({ delay: 2000 }, async (ctx, { flowDynamic, provider }) => {
        const mensaje = ctx.body;
        const clienteId = ctx.from;

        // Obtener la instancia de sock
        const sock = await provider.getInstance();

        // Escuchar los mensajes entrantes
        sock.ev.on('messages.upsert', async ({ messages }) => {
            const message = messages[0];
            if (!message.message) return;

            // // Si el mensaje es de tipo imagen, lo procesamos
            // if (message.message.imageMessage) {
            //     const visionResponse = await handleImageMessage(message, sock, clienteId);
            //     return await flowDynamic(visionResponse);
            // }
        });

        // Enviar datos a Gemini AI y obtener la respuesta
        const responseMessage = await sendToGeminiAi({ mensaje, clienteId });

        // Validar si la respuesta contiene el código 'e101' y adjuntar un PDF si es necesario
        // if (responseMessage.toLowerCase().includes("e101")) {
        //     await flowDynamic([{ body: "Enlace:", media: "http://192.168.0.33:3001/archivo/test.pdf" }]);
        // }

        // Enviar el mensaje de respuesta
        return await flowDynamic(responseMessage);
    });

const main = async () => {
    const adapterDB = new MockAdapter()
    const adapterFlow = createFlow([flowPrincipal])
    const adapterProvider = createProvider(BaileysProvider)

    createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    QRPortalWeb()
}

main()
