const express = require("express");
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require("@whiskeysockets/baileys");
const dotenv = require("dotenv");

// Cargar variables de entorno
dotenv.config({ path: "../.env" });

const app = express();
app.use(express.json());

const ventasNumero = "573182473152@s.whatsapp.net"; // Número en formato correcto

let sock; // Variable global para mantener la sesión

// Función para inicializar WhatsApp con reconexión automática
async function iniciarWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState("./auth_info_baileys");
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on("creds.update", saveCreds);
    sock.ev.on("connection.update", async ({ connection, lastDisconnect }) => {
        if (connection === "open") {
            console.log("✅ Conectado a WhatsApp");
        } else if (connection === "close") {
            const reason = lastDisconnect?.error?.output?.statusCode;
            console.log(`❌ Conexión cerrada (${reason}). Intentando reconectar...`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Espera antes de reconectar
            iniciarWhatsApp();
        }
    });

    return sock;
}

// Inicializar WhatsApp
iniciarWhatsApp();

// Webhook para recibir pedidos
app.post("/", async (req, res) => {
    try {
        const { billing, status, number_id, courrier, total, products, tracking_url, message } = req.body;

        // Verificar que WhatsApp está conectado antes de enviar el mensaje
        if (!sock || !sock.user) {
            console.error("❌ WhatsApp no está conectado.");
            return res.status(500).json({ error: "WhatsApp no está conectado." });
        }

        let mensaje = `*Número de Orden:* ${number_id || "No disponible"}\n\n`;

        mensaje += `*Estado:* ${status || "Sin estado"}\n`;
        mensaje += `*Transportadora:* ${courrier || "No asignada"}\n`;
        mensaje += `*Total:* $${total || "0"}\n\n`;

        if (billing) {
            mensaje += `*Cliente:* ${billing.full_name || "Desconocido"}\n`;
            mensaje += `*Dirección:* ${billing.address || "No registrada"}, ${billing.city?.name || "Ciudad desconocida"}, ${billing.departament || "Departamento desconocido"}\n`;
            mensaje += `*Teléfono:* ${billing.phone || "No disponible"}\n`;
            mensaje += `*Email:* ${billing.email || "No proporcionado"}\n\n`;
        }



        if (products?.length) {
            const product = products[0];
            mensaje += `*Producto:* ${product.from || "Sin nombre"}\n`;
            mensaje += `*Cantidad:* ${product.quantity || "0"}\n`;
            mensaje += `*Precio:* $${product.changedPrice || product.price || "0"}\n`;
            if (product.image) mensaje += `*Imagen:* ${product.image}\n\n`;
        }

        if (message) mensaje += `*Mensaje:* ${message}\n`;

        console.log("Enviando mensaje a:", ventasNumero);
        console.log(mensaje);

        await sock.sendMessage(ventasNumero, { text: mensaje.trim() });

        console.log("✅ Mensaje enviado correctamente.");
        res.status(200).json({ message: "Mensaje enviado con éxito" });
    } catch (error) {
        console.error("❌ Error en el webhook:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

const PORT = 7000;
app.listen(PORT, () => {
    console.log(`🚀 Webhook escuchando en http://localhost:${PORT}/webhook`);
});
