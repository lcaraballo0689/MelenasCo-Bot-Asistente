const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const dotenv = require('dotenv');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

dotenv.config({ path: '../.env' });
const systemInstruction = require('./iaModels/vendedora');
const transferencia = require('./iaModels/transferencia');

const app = express();
app.use(express.json());

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('Error: La API Key de Gemini no está definida.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash', systemInstruction });

const historialChats = {};
const clientesInfo = {};
const ventasNumero = "573196233749@s.whatsapp.net";

function getClientName(clienteId) {
    return ` ${clienteId.split('@')[0]}`;
}

async function sendVCard(sock, recipient, clienteId, infoCliente) {
    let mensaje = `Contacto del Cliente\nNombre: ${infoCliente.nombre}\nHorario: ${infoCliente.horario}\nIntención: ${infoCliente.intencion}`;
    console.log("+++++++++++++++infoCliente: ", recipient);

    await sock.sendMessage(recipient, { text: mensaje });
    const vcard = {
        displayName: 'Contacto del Cliente',
        vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:${infoCliente.nombre}\nTEL:${clienteId.split('@')[0]}\nEND:VCARD`,
    };
    await sock.sendMessage(recipient, { contacts: { displayName: vcard.displayName, contacts: [vcard] } });
}

function limpiarHistorial(history) {
    if (history.length > 10) {
        history.shift();
    }
    return history;
}

async function recopilarInformacionCliente(sock, clienteId, mensaje, infoCliente) {
    if (infoCliente.estado === 'nombre') {
        infoCliente.nombre = mensaje;
        infoCliente.estado = 'horario';

        // Utilizar la IA para generar una respuesta contextual
        const promptContexto = `${transferencia}

## Mensaje del Cliente:
"${mensaje}"
`;
        const resultContexto = await model.generateContent(promptContexto);
        const respuestaContexto = resultContexto.response.text();

        // Enviar la respuesta contextual y luego preguntar por el horario
        await sock.sendMessage(clienteId, { text: respuestaContexto });
        await sock.sendMessage(clienteId, { text: `¿En qué horario prefieres que te llamemos? ` });

        try {
            const cliente = getClientName(clienteId);

            console.log("cliente:", cliente);
            const group = await sock.groupCreate(`Melenas Co. - ${cliente} `, ["573196233749@s.whatsapp.net", clienteId]);    
                console.log("Grupo creado con ID:", group.id);
                await sock.updateProfilePicture(jid, { url: './new-profile-picture.jpeg' })
            // Promote to admin
            const respo = await sock.groupParticipantsUpdate(group.id, ["573196233749@s.whatsapp.net"], "promote");
                console.log("Grupo promovido:", respo);

            const resp = await sock.groupParticipantsUpdate(group.id, [clienteId], "demote");
                console.log("Grupo promovido:", respo);

            

           
        } catch (error) {
            console.error("Error en la gestión del grupo:", error);
        }



        return;
    }
    if (infoCliente.estado === 'horario') {
        infoCliente.horario = mensaje;
        infoCliente.estado = 'intencion';
        await sock.sendMessage(clienteId, { text: 'Prefieres que te atienda por chat o por llamada' });
        return;
    }
    if (infoCliente.estado === 'intencion') {
        infoCliente.intencion = mensaje;
        infoCliente.estado = 'completo';

        await sendVCard(sock, ventasNumero, `+${clienteId}`, infoCliente);
        delete clientesInfo[clienteId];
        await sock.sendMessage(clienteId, { text: 'Gracias, Ya te estoy transfiriendo con uno de nuestros Asesores' });
        return;
    }
     // Remove bot from group
     // Send message to the group
            sock.sendMessage(group.id, { text: "En breve, un asesor se pondrá en contacto contigo pronto para ayudarte." });
     const rsp = await sock.groupParticipantsUpdate(group.id, ["573182473152@s.whatsapp.net"], "remove"); 
}

async function procesarMensaje(mensaje, clienteId, sock) {
    try {
        if (!mensaje || !clienteId) return { error: 'Mensaje y clienteId son requeridos.' };

        let history = historialChats[clienteId] || [];
        history = limpiarHistorial(history);

        const promptIntencion = `Clasifica la siguiente pregunta en una de estas categorías: compra, informacion, saludo, otro. Pregunta: "${mensaje}"`;
        const resultIntencion = await model.generateContent(promptIntencion);
        const respuestaIntencion = await resultIntencion.response;
        let intent = respuestaIntencion.text().toLowerCase();

        if (intent.includes('compra') && !clientesInfo[clienteId]) {
            // await sock.sendMessage(clienteId, { text: '¡Claro! Para darte la mejor atención, necesito algunos datos.' });
            clientesInfo[clienteId] = { estado: 'nombre', nombre: '', horario: '', intencion: '' };
        }

        const infoCliente = clientesInfo[clienteId];
        if (infoCliente && infoCliente.estado !== 'completo') {
            await recopilarInformacionCliente(sock, clienteId, mensaje, infoCliente);
            return { response: null, intent: `recopilando_${infoCliente.estado}` };
        }

        let chat = model.startChat({
            history: history.map(msg => ({ role: msg.role, parts: [{ text: msg.content }] }))
        });

        const result = await chat.sendMessage(String(mensaje));
        const response = await result.response;
        let text = response.text();

        history.push({ role: 'user', content: mensaje });
        history.push({ role: 'model', content: text });
        historialChats[clienteId] = history;

        return { response: text, intent };
    } catch (error) {
        console.error('Error al procesar el mensaje:', error);
        return { response: 'Lo siento, hubo un problema. Por favor, intenta de nuevo más tarde.', intent: 'error' };
    }
}

async function iniciarBot() {

    const authFolder = path.join(__dirname, 'auth');
    if (!fs.existsSync(authFolder)) fs.mkdirSync(authFolder);

    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log('Escanea este QR para iniciar sesión');
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
            console.log('✅ Bot conectado exitosamente');
        } else if (connection === 'close') {
            console.log('⚠️ Conexión cerrada, intentando reconectar...');
            iniciarBot();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const mensajeTexto = msg.message.conversation || msg.message.extendedTextMessage?.text;
        if (!mensajeTexto) return;

        const sender = msg.key.remoteJid;
        const resultado = await procesarMensaje(mensajeTexto, sender, sock);
        if (resultado.response) {
            await sock.sendMessage(sender, { text: resultado.response });
        }
    });
}

iniciarBot();

app.listen(3000, () => {
    console.log('🤖 Servidor corriendo en el puerto 3000');
});