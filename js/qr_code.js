// QR Codes Page JavaScript
document.addEventListener('DOMContentLoaded', function() {

    // DOM Elements
    const qrUrlInput = document.getElementById('qrUrl');
    const qrSizeSelect = document.getElementById('qrSize');
    const qrColorPicker = document.getElementById('qrColor');
    const printPosterBtn = document.getElementById('printPosterBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const qrUrlDisplay = document.getElementById('qrUrlDisplay');
    const qrContainer = document.getElementById('qrcode');

    // Default URL
    const defaultUrl = 'https://municipality-css.vercel.app/';

    // Function to generate QR code
    function generateQRCode() {
        // Make sure container exists
        if (!qrContainer) {
            console.error('QR container not found');
            return;
        }

        const url = qrUrlInput.value.trim() || defaultUrl;
        const size = parseInt(qrSizeSelect.value) || 200;
        const color = qrColorPicker.value || '#1e3c72';

        // Update display URL
        if (qrUrlDisplay) {
            qrUrlDisplay.textContent = url;
        }

        // Clear previous QR code - IMPORTANT: clear innerHTML
        qrContainer.innerHTML = '';

        try {
            // Generate new QR code
            new QRCode(qrContainer, {
                text: url,
                width: size,
                height: size,
                colorDark: color,
                colorLight: "#ffffff",
                correctLevel: QRCode.CorrectLevel.H
            });
            console.log('✅ QR Code generated for:', url);
        } catch (error) {
            console.error('QR Generation error:', error);
            qrContainer.innerHTML = '<p style="color:red;">Error generating QR code</p>';
        }
    }

    // Auto-generate on ANY change
    if (qrUrlInput) {
        qrUrlInput.addEventListener('input', generateQRCode);
    }
    if (qrSizeSelect) {
        qrSizeSelect.addEventListener('change', generateQRCode);
    }
    if (qrColorPicker) {
        qrColorPicker.addEventListener('change', generateQRCode);
    }

    // Color preset buttons
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', function() {
            const color = this.getAttribute('data-color');
            if (qrColorPicker) {
                qrColorPicker.value = color;
                generateQRCode();
            }
        });
    });

    // Print Poster
    if (printPosterBtn) {
        printPosterBtn.addEventListener('click', function() {
            const url = qrUrlInput.value.trim() || defaultUrl;
            const size = parseInt(qrSizeSelect.value) || 200;
            const color = qrColorPicker.value || '#1e3c72';

            const printWindow = window.open('', '_blank');
            printWindow.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Print Poster - Municipality of Luisiana Survey</title>
                    <style>
                        * {
                            margin: 0;
                            padding: 0;
                            box-sizing: border-box;
                        }
                        body {
                            font-family: 'DM Sans', system-ui, 'Segoe UI', sans-serif;
                            background: white;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            min-height: 100vh;
                            padding: 20px;
                        }
                        .poster {
                            max-width: 800px;
                            width: 100%;
                            margin: 0 auto;
                            padding: 40px;
                            text-align: center;
                            background: white;
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
                            letter-spacing: -0.5px;
                        }
                        h2 {
                            font-size: 20px;
                            color: #2563eb;
                            margin-bottom: 30px;
                            font-weight: 500;
                        }
                        .qr-container {
                            display: flex;
                            justify-content: center;
                            margin: 30px 0;
                        }
                        .instruction {
                            font-size: 18px;
                            font-weight: 600;
                            margin: 20px 0 10px;
                            color: #1f2937;
                        }
                        .sub-instruction {
                            font-size: 14px;
                            color: #6b7280;
                            margin-bottom: 20px;
                        }
                        .url {
                            font-size: 12px;
                            color: #9ca3af;
                            word-break: break-all;
                            margin-top: 20px;
                        }
                        .footer {
                            margin-top: 40px;
                            padding-top: 20px;
                            border-top: 1px solid #e5e7eb;
                            font-size: 12px;
                            color: #9ca3af;
                        }
                        @media print {
                            body {
                                padding: 0;
                                margin: 0;
                            }
                            .poster {
                                padding: 20px;
                            }
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
                        <div class="sub-instruction">Your feedback helps us serve you better</div>
                        <div class="url">${url}</div>
                        <div class="footer">© ${new Date().getFullYear()} Municipality of Luisiana. All Rights Reserved.</div>
                    </div>
                    <script>
                        new QRCode(document.getElementById("posterQR"), {
                            text: "${url}",
                            width: ${size + 50},
                            height: ${size + 50},
                            colorDark: "${color}",
                            colorLight: "#ffffff",
                            correctLevel: QRCode.CorrectLevel.H
                        });
                        setTimeout(() => window.print(), 500);
                    <\/script>
                </body>
                </html>
            `);
            printWindow.document.close();
        });
    }

    // Download QR Code as PNG
    if (downloadBtn) {
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

    // Initial generation - THIS IS KEY
    generateQRCode();
});