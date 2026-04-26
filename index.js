const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ASAAS_KEY = process.env.ASAAS_KEY;
const ASAAS_URL = 'https://www.asaas.com/api/v3';

app.get('/api/numeros', async (req, res) => {
    try {
        const { data } = await supabase.from('rifas').select('*').order('numero', { ascending: true });
        res.json(data || []);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/checkout', async (req, res) => {
    const { numeros, nome, email, telefone, cpf, metodo, cardData } = req.body;
    try {
        const buscaCli = await axios.get(`${ASAAS_URL}/customers?email=${email}`, { headers: { access_token: ASAAS_KEY } });
        let customerId = buscaCli.data.totalCount > 0 ? buscaCli.data.data[0].id : (await axios.post(`${ASAAS_URL}/customers`, { 
            name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''), mobilePhone: telefone.replace(/\D/g, '') 
        }, { headers: { access_token: ASAAS_KEY } })).data.id;
        
        const paymentRes = await axios.post(`${ASAAS_URL}/payments`, {
            customer: customerId,
            billingType: metodo === 'CREDIT_CARD' ? 'CREDIT_CARD' : 'PIX',
            value: numeros.length * 10,
            dueDate: new Date().toISOString().split('T')[0],
            description: `Rifa Kelly - Números: ${numeros.join(',')}`,
            creditCard: metodo === 'CREDIT_CARD' ? {
                holderName: cardData.holderName, number: cardData.number, expiryMonth: cardData.expiryMonth, expiryYear: cardData.expiryYear, ccv: cardData.ccv
            } : undefined,
            creditCardHolderInfo: metodo === 'CREDIT_CARD' ? { 
                name: nome, email, cpfCnpj: cpf.replace(/\D/g, ''), postalCode: '88000000', addressNumber: '1', phone: telefone.replace(/\D/g, '') 
            } : undefined
        }, { headers: { access_token: ASAAS_KEY } });

        let pix = null;
        if(metodo === 'PIX') {
            const qr = await axios.get(`${ASAAS_URL}/payments/${paymentRes.data.id}/pixQrCode`, { headers: { access_token: ASAAS_KEY } });
            pix = { code: qr.data.payload, image: qr.data.encodedImage };
        }
        await supabase.from('rifas').update({ status: 'reservado', cpf_comprador: cpf.replace(/\D/g, ''), id_pagamento: paymentRes.data.id }).in('numero', numeros);
        res.json({ success: true, pix });
    } catch (e) { res.status(500).json({ error: "Falha no pagamento" }); }
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
module.exports = app;