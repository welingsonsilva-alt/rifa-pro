const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASAAS_KEY = process.env.ASAAS_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/numeros', async (req, res) => {
    const { data } = await supabase.from('rifas').select('*').order('numero', { ascending: true });
    res.json(data || []);
});

app.post('/api/checkout', async (req, res) => {
    const { numeros, nome, email, telefone, cpf, metodo, cardData } = req.body;
    try {
        // 1. Criar ou Buscar Cliente
        const buscaCli = await axios.get(`${ASAAS_URL}/customers?email=${email}`, { headers: { access_token: ASAAS_KEY } });
        let customerId = buscaCli.data.totalCount > 0 ? buscaCli.data.data[0].id : (await axios.post(`${ASAAS_URL}/customers`, { 
            name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''), mobilePhone: telefone.replace(/\D/g, '') 
        }, { headers: { access_token: ASAAS_KEY } })).data.id;

        // 2. Criar Cobrança
        const paymentPayload = {
            customer: customerId,
            billingType: metodo === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX',
            value: numeros.length * 10,
            dueDate: new Date().toISOString().split('T')[0],
            description: `Rifa da Kelly - Números: ${numeros.join(',')}`,
            externalReference: cpf.replace(/\D/g, '')
        };

        if (metodo === 'CREDIT_CARD') {
            paymentPayload.creditCard = {
                holderName: cardData.holderName,
                number: cardData.number,
                expiryMonth: cardData.expiryMonth,
                expiryYear: cardData.expiryYear,
                ccv: cardData.ccv
            };
            paymentPayload.creditCardHolderInfo = {
                name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''),
                postalCode: '88000000', addressNumber: '1', phone: telefone.replace(/\D/g, '')
            };
        }

        const payment = await axios.post(`${ASAAS_URL}/payments`, paymentPayload, { headers: { access_token: ASAAS_KEY } });

        // 3. Se for PIX, pegar o QR Code
        let pixRes = null;
        if (metodo === 'PIX') {
            const qr = await axios.get(`${ASAAS_URL}/payments/${payment.data.id}/pixQrCode`, { headers: { access_token: ASAAS_KEY } });
            pixRes = { code: qr.data.payload, image: qr.data.encodedImage };
        }

        // 4. Reservar no Banco
        await supabase.from('rifas').update({ 
            status: 'reservado', 
            cpf_comprador: cpf.replace(/\D/g, ''), 
            id_pagamento: payment.data.id, 
            updated_at: new Date().toISOString() 
        }).in('numero', numeros);

        res.json({ success: true, metodo, pix: pixRes, paymentId: payment.data.id });
    } catch (e) { 
        res.status(500).json({ error: e.response?.data?.errors[0]?.description || "Erro no processamento" }); 
    }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
module.exports = app;