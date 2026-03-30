const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { query } = require('../DataBase/conection');

async function gerarRelatorioPDF(clienteId) {
    return new Promise(async (resolve, reject) => {
        try {
            console.log(`📄 [PDF] Iniciando busca no banco para o Cliente ID: ${clienteId}...`);
            
            const res = await query('SELECT * FROM leads WHERE cliente_id = $1 ORDER BY id DESC', [clienteId]);
            console.log(`📄 [PDF] Busca concluída! Encontrou ${res.rows.length} leads.`);
            
            const doc = new PDFDocument({ margin: 50, size: 'A4', bufferPages: true });
            const fileName = `Relatorio_Leads_Cliente${clienteId}_${Date.now()}.pdf`;
            const filePath = path.join(__dirname, '..', fileName);
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);

            // --- CABEÇALHO ---
            doc.rect(0, 0, 612, 100).fill('#1e1b4b'); 
            
            doc.fillColor('#ffffff')
               .fontSize(24)
               .font('Helvetica-Bold')
               .text('LeadsFlow', 50, 40);
            
            doc.fontSize(10)
               .font('Helvetica')
               .text('RELATÓRIO DE LEADS CAPTURADOS', 50, 70);

            doc.fontSize(10)
               .text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 400, 55, { align: 'right' });

            doc.moveDown(5);

            // --- ESTRUTURA DA TABELA ---
            const tableTop = 150;
            const itemCodeX = 50;
            const descriptionX = 100;
            const phoneX = 300;
            const dateX = 450;

            doc.fillColor('#4b5563').font('Helvetica-Bold').fontSize(10);
            doc.text('ID', itemCodeX, tableTop);
            doc.text('NOME DO LEAD', descriptionX, tableTop);
            doc.text('WHATSAPP', phoneX, tableTop);
            doc.text('STATUS', dateX, tableTop);

            doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).strokeColor('#e5e7eb').stroke();

            // --- LINHAS DA TABELA (OU AVISO DE VAZIO) ---
            let currentY = tableTop + 30;
            doc.font('Helvetica').fillColor('#374151');

            if (res.rows.length === 0) {
                // Se o banco estiver vazio, escreve isso no PDF
                doc.fontSize(12).fillColor('#ef4444').text('Nenhum lead capturado para este cliente até o momento.', 50, currentY);
            } else {
                res.rows.forEach((lead, index) => {
                    if (index % 2 === 0) {
                        doc.rect(50, currentY - 5, 500, 20).fill('#f9fafb');
                        doc.fillColor('#374151');
                    }

                    doc.text(index + 1, itemCodeX, currentY);
                    doc.text(lead.nome || 'Sem nome', descriptionX, currentY, { width: 180, ellipsis: true });
                    doc.text(lead.celular || 'S/N', phoneX, currentY);
                    doc.text('Capturado', dateX, currentY);

                    currentY += 20;

                    if (currentY > 750) {
                        doc.addPage();
                        currentY = 50; 
                    }
                });
            }

            // --- Rodapé Dinâmico e Seguro ---
            const range = doc.bufferedPageRange(); 
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.fontSize(8).fillColor('#9ca3af').text(
                    `LeadsFlow - Gestão Inteligente de Leads | Página ${i - range.start + 1} de ${range.count}`,
                    50, 780, { align: 'center' }
                );
            }

            console.log(`📄 [PDF] Desenhando arquivo...`);
            doc.end();

            stream.on('finish', () => {
                console.log(`📄 [PDF] Arquivo salvo fisicamente! Enviando para o WhatsApp...`);
                resolve({ fileName, filePath });
            });
        } catch (err) {
            console.error(`❌ [PDF] Erro fatal:`, err);
            reject(err);
        }
    });
}

module.exports = { gerarRelatorioPDF };