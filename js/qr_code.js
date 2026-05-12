// QR Codes Page JavaScript
document.addEventListener('DOMContentLoaded', function() {

    // DOM Elements
    const qrUrlInput = document.getElementById('qrUrl');
    const qrSizeSelect = document.getElementById('qrSize');
    const qrColorPicker = document.getElementById('qrColor');
    const generateBtn = document.getElementById('generateBtn');
    const printBtn = document.getElementById('printBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const qrUrlDisplay = document.getElementById('qrUrlDisplay');
    const qrContainer = document.getElementById('qrcode');

    let currentQR = null;

    // Default URL
    const defaultUrl = 'https://municipality-css.vercel.app/';

    // Generate QR Code
    function generateQRCode() {
        const url = qrUrlInput.value.trim() || defaultUrl;
        const size = parseInt(qrSizeSelect.value);
        const color = qrColorPicker.value;

        // Update display URL
        qrUrlDisplay.textContent = url;

        // Clear previous QR code
        qrContainer.innerHTML = '';

        // Generate new QR code
        currentQR = new QRCode(qrContainer, {
            text: url,
            width: size,
            height: size,
            colorDark: color,
            colorLight: "#ffffff",
            correctLevel: QRCode.CorrectLevel.H
        });

        console.log('QR Code generated for:', url);
    }

    // Color preset buttons
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', function() {
            const color = this.getAttribute('data-color');
            qrColorPicker.value = color;
            generateQRCode();
        });
    });

    // Generate on input changes
    qrUrlInput.addEventListener('input', generateQRCode);
    qrSizeSelect.addEventListener('change', generateQRCode);
    qrColorPicker.addEventListener('change', generateQRCode);
    generateBtn.addEventListener('click', generateQRCode);

    // Print QR Code
    printBtn.addEventListener('click', function() {
        const printWindow = window.open('', '_blank');
        const url = qrUrlInput.value.trim() || defaultUrl;
        const size = parseInt(qrSizeSelect.value);

        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print QR Code</title>
                <style>
                    body {
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        min-height: 100vh;
                        margin: 0;
                        padding: 20px;
                        font-family: 'DM Sans', system-ui, sans-serif;
                    }
                    .print-container {
                        text-align: center;
                    }
                    .qr-wrapper {
                        margin: 20px auto;
                    }
                    .title {
                        font-size: 24px;
                        font-weight: bold;
                        margin: 20px 0 10px;
                        color: #1e3c72;
                    }
                    .subtitle {
                        font-size: 16px;
                        color: #555;
                        margin-bottom: 30px;
                    }
                    .url {
                        font-size: 12px;
                        color: #666;
                        word-break: break-all;
                        margin-top: 20px;
                    }
                    @media print {
                        button { display: none; }
                    }
                </style>
                <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
                <div class="print-container">
                    <div id="printQR" class="qr-wrapper"></div>
                    <div class="title">Client Satisfaction Survey</div>
                    <div class="subtitle">Bayan ng Luisiana</div>
                    <div class="url">${url}</div>
                    <button onclick="window.print()" style="margin-top:20px; padding:8px 16px;">Print</button>
                </div>
                <script>
                    new QRCode(document.getElementById("printQR"), {
                        text: "${url}",
                        width: ${size},
                        height: ${size},
                        colorDark: "${qrColorPicker.value}",
                        colorLight: "#ffffff"
                    });
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    });

    // Download QR Code as PNG
    downloadBtn.addEventListener('click', function() {
        const qrCanvas = qrContainer.querySelector('canvas');
        if (qrCanvas) {
            const link = document.createElement('a');
            link.download = 'survey-qr-code.png';
            link.href = qrCanvas.toDataURL();
            link.click();
            showToast('QR Code downloaded!', '#10b981');
        } else {
            showToast('Generate QR code first', '#f59e0b');
        }
    });

    // Template printing
    document.querySelectorAll('.btn-template').forEach(btn => {
        btn.addEventListener('click', function() {
            const template = this.getAttribute('data-template');
            const url = qrUrlInput.value.trim() || defaultUrl;
            const color = qrColorPicker.value;

            if (template === 'poster') {
                printPosterTemplate(url, color);
            } else if (template === 'sticker') {
                printStickerTemplate(url, color);
            } else if (template === 'multiple') {
                printMultipleTemplate(url, color);
            }
        });
    });

    function printPosterTemplate(url, color) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Poster - QR Code</title>
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: 'DM Sans', system-ui, sans-serif;
                    }
                    .poster {
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 40px;
                        text-align: center;
                        border: 1px solid #ddd;
                        border-radius: 16px;
                    }
                    .logos {
                        display: flex;
                        justify-content: center;
                        gap: 30px;
                        margin-bottom: 30px;
                    }
                    .logos img {
                        width: 80px;
                        height: 80px;
                        object-fit: contain;
                    }
                    h1 {
                        font-size: 28px;
                        color: #1e3c72;
                        margin: 20px 0 10px;
                    }
                    h2 {
                        font-size: 20px;
                        color: #2563eb;
                        margin-bottom: 30px;
                    }
                    .qr-container {
                        display: flex;
                        justify-content: center;
                        margin: 30px 0;
                    }
                    .instruction {
                        font-size: 18px;
                        font-weight: 500;
                        margin: 20px 0 10px;
                    }
                    .url {
                        font-size: 12px;
                        color: #666;
                        word-break: break-all;
                    }
                    .footer {
                        margin-top: 40px;
                        font-size: 12px;
                        color: #999;
                    }
                    @media print {
                        body { background: white; }
                        .poster { border: none; }
                    }
                </style>
                <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
                <div class="poster">
                    <div class="logos">
                        <img src="/images/bagong_pilipinas_logo.png" alt="Bagong Pilipinas">
                        <img src="/images/luisiana_logo.png" alt="Luisiana">
                    </div>
                    <h1>Municipality of Luisiana</h1>
                    <h2>Client Satisfaction Survey</h2>
                    <div id="posterQR" class="qr-container"></div>
                    <div class="instruction">Scan this QR code to take our survey</div>
                    <div class="url">${url}</div>
                    <div class="footer">Your feedback helps us serve you better</div>
                </div>
                <script>
                    new QRCode(document.getElementById("posterQR"), {
                        text: "${url}",
                        width: 250,
                        height: 250,
                        colorDark: "${color}",
                        colorLight: "#ffffff"
                    });
                    setTimeout(() => window.print(), 500);
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    function printStickerTemplate(url, color) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Stickers - QR Code</title>
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: Arial, sans-serif;
                    }
                    .sticker-page {
                        display: grid;
                        grid-template-columns: repeat(4, 1fr);
                        gap: 20px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .sticker {
                        text-align: center;
                        border: 1px dashed #ccc;
                        padding: 10px;
                        border-radius: 8px;
                    }
                    .sticker .qr {
                        margin: 10px auto;
                    }
                    .sticker p {
                        font-size: 10px;
                        margin: 5px 0;
                    }
                    @media print {
                        .sticker { border: none; }
                    }
                </style>
                <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
                <div class="sticker-page" id="stickerPage"></div>
                <script>
                    const page = document.getElementById('stickerPage');
                    for(let i = 0; i < 8; i++) {
                        const sticker = document.createElement('div');
                        sticker.className = 'sticker';
                        sticker.innerHTML = \`
                            <div id="stickerQR\${i}" class="qr"></div>
                            <p>Scan to take survey</p>
                            <p style="font-size:8px;">municipality-css.vercel.app</p>
                        \`;
                        page.appendChild(sticker);
                        new QRCode(document.getElementById("stickerQR\${i}"), {
                            text: "${url}",
                            width: 80,
                            height: 80,
                            colorDark: "${color}",
                            colorLight: "#ffffff"
                        });
                    }
                    setTimeout(() => window.print(), 500);
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    function printMultipleTemplate(url, color) {
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Multiple QR Codes</title>
                <style>
                    body {
                        margin: 0;
                        padding: 20px;
                        font-family: Arial, sans-serif;
                    }
                    .grid-page {
                        display: grid;
                        grid-template-columns: repeat(2, 1fr);
                        gap: 30px;
                        max-width: 800px;
                        margin: 0 auto;
                    }
                    .qr-item {
                        text-align: center;
                        border: 1px solid #eee;
                        padding: 20px;
                        border-radius: 12px;
                    }
                    .qr-item .qr {
                        margin: 15px auto;
                    }
                    .qr-item h4 {
                        margin: 10px 0 5px;
                        font-size: 14px;
                    }
                    @media print {
                        .qr-item { border: none; }
                    }
                </style>
                <script src="https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js"><\/script>
            </head>
            <body>
                <div class="grid-page" id="gridPage"></div>
                <script>
                    const page = document.getElementById('gridPage');
                    const qrSize = 180;
                    for(let i = 0; i < 4; i++) {
                        const item = document.createElement('div');
                        item.className = 'qr-item';
                        item.innerHTML = \`
                            <div id="qr\${i}" class="qr"></div>
                            <h4>Client Satisfaction Survey</h4>
                            <p>Bayan ng Luisiana</p>
                            <p style="font-size:10px;">Scan to take survey</p>
                        \`;
                        page.appendChild(item);
                        new QRCode(document.getElementById("qr\${i}"), {
                            text: "${url}",
                            width: qrSize,
                            height: qrSize,
                            colorDark: "${color}",
                            colorLight: "#ffffff"
                        });
                    }
                    setTimeout(() => window.print(), 500);
                <\/script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }

    // Toast notification
    function showToast(message, color) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: ${color};
            color: white;
            padding: 0.75rem 1.5rem;
            border-radius: 12px;
            font-size: 0.875rem;
            font-weight: 500;
            z-index: 3000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease;
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    // Add slideIn animation if not exists
    if (!document.querySelector('#toast-style')) {
        const style = document.createElement('style');
        style.id = 'toast-style';
        style.textContent = `@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
        document.head.appendChild(style);
    }

    // Initial generation
    generateQRCode();
});