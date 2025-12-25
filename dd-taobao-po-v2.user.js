// ==UserScript==
// @name         Dangdang & Taobao Order to PO Table v2.1
// @namespace    http://tampermonkey.net/dd-taobao-po-v2
// @version      2.0
// @description  Convert Dangdang and Taobao order pages to PO table format
// @connect      *
// @run-at       document-start
// @author       You
// @match        https://orderb.dangdang.com/myorder/order_detail_module.php*
// @match        https://orderb.dangdang.com/orderDetail*
// @match        https://main.dangdang.com/orderDetail*
// @match        https://*.dangdang.com/orderDetail*
// @match        https://*.taobao.com/*
// @match        *://*.tmall.com/*
// @match        https://buyertrade.taobao.com/*
// @match        https://trade.taobao.com/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      unbound-backend.azurewebsites.net
// @run-at document-start
// ==/UserScript==

(function() {
    'use strict';

    // Detect platform
    const PLATFORM = {
        DANGDANG: 'dangdang',
        TAOBAO: 'taobao'
    };
// ========== SEMI-AUTOMATIC EXTRACTION VARIABLES ==========
let isbnExtractionQueue = [];
let currentQueueIndex = 0;
let extractedISBNs = {};
let openedWindows = [];

    function getCurrentPlatform() {
        const hostname = window.location.hostname;
        if (hostname.includes('dangdang.com')) {
            return PLATFORM.DANGDANG;
        } else if (hostname.includes('taobao.com')) {
            return PLATFORM.TAOBAO;
        }
        return null;
    }

    // Add custom styles for the export button
    GM_addStyle(`
        #dd-export-btn {
            position: fixed;
            top: 150px;
            right: 20px;
            z-index: 9999;
            padding: 12px 24px;
            background-color: #ff2832;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
        }
        #dd-export-btn:hover {
            background-color: #e02028;
        }
        #dd-export-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            min-width: 500px;
            max-width: 90vw;
            max-height: 90vh;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
        }
        #dd-export-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 9999;
        }
        .modal-title {
            font-size: 18px;
            font-weight: bold;
            margin-bottom: 20px;
            color: #333;
        }
        .modal-content {
            margin-bottom: 20px;
        }
        .modal-textarea {
            width: 100%;
            height: 150px;
            padding: 10px;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-family: monospace;
            font-size: 12px;
            resize: vertical;
        }
        .modal-buttons {
            display: flex;
            gap: 10px;
            justify-content: flex-end;
        }
        .modal-btn {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .modal-btn-primary {
            background-color: #ff2832;
            color: white;
        }
        .modal-btn-secondary {
            background-color: #f0f0f0;
            color: #333;
        }
        .modal-btn:hover {
            opacity: 0.9;
        }
        .order-info-display {
            background: #f5f5f5;
            padding: 15px;
            border-radius: 4px;
            margin-bottom: 15px;
            font-size: 13px;
        }
        .order-info-display div {
            margin-bottom: 5px;
        }
        .platform-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: bold;
            margin-left: 8px;
        }
        .platform-dangdang {
            background-color: #ff2832;
            color: white;
        }
        .platform-taobao {
            background-color: #ff6600;
            color: white;
        }
    `);

    // ========== DANGDANG EXTRACTION ==========
    function extractDangdangOrderData() {
        const orderData = {
            platform: PLATFORM.DANGDANG,
            orderNumber: '',
            packageNumber: '',
            packages: [],
            items: []
        };

        // Extract order number
        const orderIdElement = document.querySelector('.order-id span:last-child');
        if (orderIdElement) {
            orderData.orderNumber = orderIdElement.textContent.trim();
        }

        // Try to extract package number from visible tab
        const packageTabs = document.querySelectorAll('.package-tabs .tab');
        const hasMultiplePackages = packageTabs.length > 0;

        if (hasMultiplePackages) {
            const allPackageNumbers = [];
            document.querySelectorAll('.receiver-info .item').forEach(item => {
                const labelSpan = item.querySelector('.item__label');
                if (labelSpan && labelSpan.textContent.includes('包裹号')) {
                    const valueSpan = item.querySelector('.item__text');
                    if (valueSpan) {
                        allPackageNumbers.push(valueSpan.textContent.trim());
                    }
                }
            });
            orderData.packageNumber = allPackageNumbers.join(', ');
        } else {
            const packageNumberItems = document.querySelectorAll('.receiver-info .item');
            packageNumberItems.forEach(item => {
                const labelSpan = item.querySelector('.item__label');
                if (labelSpan && labelSpan.textContent.includes('包裹号')) {
                    const valueSpan = item.querySelector('.item__text');
                    if (valueSpan) {
                        orderData.packageNumber = valueSpan.textContent.trim();
                    }
                }
            });
        }

        // Extract product information from the table
        const productRows = document.querySelectorAll('.ant-table-tbody tr.ant-table-row');
// FINAL CORRECT FIX - Handles both table structures
// Table WITHOUT 包件: 商品名称 | 当当价 | 数量 | 银铃铛 | 优惠 | 小计 | 操作
// Table WITH 包件:    包件 | 商品名称 | 当当价 | 数量 | 银铃铛 | 优惠 | 小计 | 操作

// Replace the productRows.forEach section in extractDangdangOrderData():

productRows.forEach(row => {
    // Skip gift items (赠品)
    const isGift = row.querySelector('.pro-tag');
    if (isGift && isGift.textContent.includes('赠品')) return;

    const productNameLink = row.querySelector('.pro-name');
    const cells = row.querySelectorAll('td');

    if (!productNameLink || cells.length < 6) return;

    // Detect if this row has a package column (包件)
    // Check if first cell has colspan="1" rowspan="1" and contains "包件"
    const hasPackageColumn = cells[0].hasAttribute('colspan') &&
                             cells[0].hasAttribute('rowspan') &&
                             cells[0].textContent.includes('包件');

    // Determine cell indices based on table structure
    let nameIndex, priceIndex, quantityIndex, pointIndex, discountIndex, subtotalIndex;

    if (hasPackageColumn) {
        // Table with 包件 column: [包件, 商品名称, 当当价, 数量, 银铃铛, 优惠, 小计, 操作]
        nameIndex = 1;
        priceIndex = 2;
        quantityIndex = 3;
        pointIndex = 4;
        discountIndex = 5;
        subtotalIndex = 6;
    } else {
        // Table without 包件 column: [商品名称, 当当价, 数量, 银铃铛, 优惠, 小计, 操作]
        nameIndex = 0;
        priceIndex = 1;
        quantityIndex = 2;
        pointIndex = 3;
        discountIndex = 4;
        subtotalIndex = 5;
    }

    const productName = productNameLink.textContent.trim();
    const productUrl = productNameLink.href;

    // Extract package name if present
    const packageName = hasPackageColumn ? cells[0].textContent.trim() : '';

    // Extract 当当价 (Dangdang listed price)
    const dangdangPriceText = cells[priceIndex].textContent.trim();
    const dangdangPriceMatch = dangdangPriceText.match(/￥([\d.]+)/);
    const dangdangPrice = dangdangPriceMatch ? parseFloat(dangdangPriceMatch[1]) : 0;

    // Extract 数量 (Quantity)
    const quantity = parseInt(cells[quantityIndex].textContent.trim());

    // Extract 优惠 (Per-unit discount)
    const discountText = cells[discountIndex].textContent.trim();
    let perUnitDiscount = 0;
    if (discountText !== '-') {
        const discountMatch = discountText.match(/([\d.]+)/);
        perUnitDiscount = discountMatch ? parseFloat(discountMatch[1]) : 0;
    }

    // Extract 小计 (Subtotal)
    const subtotalText = cells[subtotalIndex].textContent.trim();
    const subtotalMatch = subtotalText.match(/￥([\d.]+)/);
    const subtotal = subtotalMatch ? parseFloat(subtotalMatch[1]) : 0;

    // Calculate actual unit price = 当当价 - 优惠
    const actualUnitPrice = dangdangPrice - perUnitDiscount;

    // Verify calculation
    const calculatedTotal = (actualUnitPrice * quantity).toFixed(2);
    const actualTotal = subtotal.toFixed(2);
    const matches = calculatedTotal === actualTotal;

    // Debug logging
    console.log(`${matches ? '✓' : '⚠️'} ${productName.substring(0, 40)}...`);
    if (packageName) console.log(`  包件: ${packageName}`);
    console.log(`  当当价: ¥${dangdangPrice.toFixed(2)}`);
    console.log(`  优惠: ¥${perUnitDiscount.toFixed(2)}/本`);
    console.log(`  实付单价: ¥${actualUnitPrice.toFixed(2)}`);
    console.log(`  数量: ${quantity}`);
    console.log(`  小计: ¥${actualTotal} ${matches ? '✓' : `(计算值: ¥${calculatedTotal})`}`);

    orderData.items.push({
        name: productName,
        url: productUrl,
        quantity: quantity.toString(),
        dangdangPrice: dangdangPrice.toFixed(2),
        discount: perUnitDiscount.toFixed(2),
        unitPrice: actualUnitPrice.toFixed(2),  // Real unit price: 当当价 - 优惠
        subtotal: subtotal.toFixed(2),
        packageName: packageName,
        isbn: ''
    });
});
        return orderData;
    }

// ========== TAOBAO EXTRACTION ==========
    // UPDATED TAOBAO EXTRACTION for new page structure (2024+)
// New structure shows: actual price, original price (strikethrough), quantity

function extractTaobaoOrderData() {
    const orderData = {
        platform: PLATFORM.TAOBAO,
        orderNumber: '',
        packageNumber: '',
        sellerName: '',
        items: []
    };

    let orderNumber = "";

    // (1) Try NEW structure first - shopInfoOrderId
    const orderIdElem = document.querySelector('.shopInfoOrderId--CVDgDEO2');
    if (orderIdElem) {
        const match = orderIdElem.textContent.match(/订单号[:：]?\s*(\d{10,})/);
        if (match) {
            orderNumber = match[1];
        }
    }

    // (2) Try old data-id on trade order wrapper
    if (!orderNumber) {
        const tradeWrapper = document.querySelector('[data-id][class*="trade-order"]');
        if (tradeWrapper) {
            orderNumber = tradeWrapper.getAttribute('data-id');
        }
    }

    // (3) Fallback: text search
    if (!orderNumber) {
        const textNodes = document.querySelectorAll('body *');
        for (const el of textNodes) {
            if (el.textContent && el.textContent.includes("订单号")) {
                const m = el.textContent.match(/订单号[:：]?\s*(\d{10,})/);
                if (m) {
                    orderNumber = m[1];
                    break;
                }
            }
        }
    }

    orderData.orderNumber = orderNumber;

    // Extract seller name - try NEW structure first
    let sellerLink = document.querySelector('.shopInfoName--SoysxOyw');
    if (!sellerLink) {
        // Fallback to old structure
        sellerLink = document.querySelector('.seller-mod__name___1_wwa');
    }
    if (sellerLink) {
        orderData.sellerName = sellerLink.textContent.trim();
    }

    // Extract items - try NEW structure first
    let itemRows = document.querySelectorAll('.itemInfo--cOJabuHA');

    // If NEW structure found, use new extraction logic
    if (itemRows.length > 0) {
        console.log(`Found ${itemRows.length} items in NEW Taobao structure`);

        itemRows.forEach(row => {
            // Get product name and URL
            const productLink = row.querySelector('.title--pLEC2yiw');
            if (!productLink) {
                console.log("SKIP ROW — no product link found");
                return;
            }

            const productNameElem = productLink.querySelector('.titleText--W0CIPGbq');
            if (!productNameElem) {
                console.log("SKIP ROW — no product name found");
                return;
            }

            const productName = productNameElem.textContent.trim();
            const productUrl = productLink.href;

            console.log("FOUND PRODUCT:", productName, productUrl);

            // Get price container
            const priceContainer = row.querySelector('.itemInfoColPrice--b9wc2Zg0');
            if (!priceContainer) {
                console.log("SKIP ROW — no price container found");
                return;
            }

            // Get all price elements (first one is actual price, second is original price)
            const priceWraps = priceContainer.querySelectorAll('.priceWrap--m0dTKjs3');

            let unitPrice = 0;
            let originalPrice = 0;

            // First price wrap = actual price paid (实付单价)
            if (priceWraps[0]) {
                const integerPart = priceWraps[0].querySelector('.trade-price-integer');
                const decimalPart = priceWraps[0].querySelector('.trade-price-decimal');
                const integer = integerPart ? integerPart.textContent.trim() : '0';
                const decimal = decimalPart ? decimalPart.textContent.trim() : '00';
                unitPrice = parseFloat(`${integer}.${decimal}`);
            }

            // Second price wrap = original price (with strikethrough) - optional
            if (priceWraps[1]) {
                const integerPart = priceWraps[1].querySelector('.trade-price-integer');
                const decimalPart = priceWraps[1].querySelector('.trade-price-decimal');
                const integer = integerPart ? integerPart.textContent.trim() : '0';
                const decimal = decimalPart ? decimalPart.textContent.trim() : '00';
                originalPrice = parseFloat(`${integer}.${decimal}`);
            }

            // Get quantity
            const quantityElem = priceContainer.querySelector('.quantity--YK5QLtR2');
            let quantity = 1;
            if (quantityElem) {
                const qtyMatch = quantityElem.textContent.match(/x(\d+)/);
                if (qtyMatch) quantity = parseInt(qtyMatch[1]);
            }

            // Calculate subtotal
            const subtotal = unitPrice * quantity;

            // ========== PRESERVE ISBN LOGIC ==========
            let isbnFromTitle = null;

            // 1. Try product name first
            isbnFromTitle = extractISBNFromText(productName);

            // 2. If not found, try the entire row text
            if (!isbnFromTitle) {
                const rowText = row.innerText || row.textContent;
                isbnFromTitle = extractISBNFromText(rowText);
            }

            // DEBUG: Log what we're setting
            console.log(`  单价: ¥${unitPrice.toFixed(2)}, 数量: ${quantity}, 小计: ¥${subtotal.toFixed(2)}`);
            console.log(`  ISBN extracted: "${isbnFromTitle}"`);

            orderData.items.push({
                name: productName,
                url: productUrl,
                quantity: quantity.toString(),
                unitPrice: unitPrice.toFixed(2),
                subtotal: subtotal.toFixed(2),
                packageName: '',
                isbn: isbnFromTitle || '' // Pre-fill ISBN if found in title
            });
        });
    } else {
        // Fallback to OLD structure
        console.log("Using OLD Taobao structure");
        itemRows = document.querySelectorAll('.bought-wrapper-mod__trade-order___2lrzV tbody tr');

        itemRows.forEach(row => {
            const links = Array.from(row.querySelectorAll("a"));

            // Step 1: find any item.taobao.com link
            let productLink = links.find(a => a.href.includes("item.taobao.com"));

            // Step 2: find the one with actual product name (non-empty innerText)
            let productNameLink = links.find(a =>
                a.href.includes("item.taobao.com") &&
                a.innerText.trim().length > 0
            );

            // Prefer productNameLink if it exists
            if (productNameLink) {
                productLink = productNameLink;
            }

            // === IMPORTANT: skip invalid rows ===
            if (!productLink) {
                console.log("SKIP ROW — no product link found");
                return;
            }
            const productName = productLink?.innerText.trim().replace(/\s+/g, " ");
            const productUrl = productLink?.href;

            console.log("FOUND PRODUCT:", productName, productUrl);

            // Extract price - look for the price cell
            const priceCell = row.querySelector('.price-mod__price___3Un7c p');
            let unitPrice = '';
            if (priceCell) {
                const priceText = priceCell.textContent.trim();
                const priceMatch = priceText.match(/￥([\d.]+)/);
                unitPrice = priceMatch ? priceMatch[1] : '';
            }

            // Extract quantity - usually in the third column
            const quantityCell = row.querySelector('td:nth-child(3) p');
            const quantity = quantityCell ? quantityCell.textContent.trim() : '1';

            // Extract subtotal - look for the strong price in actual payment column
            const subtotalCell = row.querySelector('td:nth-child(5) .price-mod__price___3Un7c strong');
            let subtotal = '';
            if (subtotalCell) {
                const subtotalText = subtotalCell.textContent.trim();
                const subtotalMatch = subtotalText.match(/￥([\d.]+)/);
                subtotal = subtotalMatch ? subtotalMatch[1] : '';
            }

            // If no subtotal found, calculate it
            if (!subtotal && unitPrice && quantity) {
                subtotal = (parseFloat(unitPrice) * parseInt(quantity)).toFixed(2);
            }

            // ========== PRESERVE ISBN LOGIC ==========
            let isbnFromTitle = null;

            // 1. Try product name first
            isbnFromTitle = extractISBNFromText(productName);

            // 2. If not found, try the entire row text
            if (!isbnFromTitle) {
                const rowText = row.innerText || row.textContent;
                isbnFromTitle = extractISBNFromText(rowText);
            }

            // DEBUG: Log what we're setting
            console.log(`  ISBN extracted: "${isbnFromTitle}"`);

            orderData.items.push({
                name: productName,
                url: productUrl,
                quantity: quantity,
                unitPrice: unitPrice,
                subtotal: subtotal,
                packageName: '',
                isbn: isbnFromTitle || '' // Pre-fill ISBN if found in title
            });
        });
    }

    return orderData;
}

// ========== NEW FUNCTION: Extract ISBN from text ==========
// ========== IMPROVED ISBN EXTRACTION FROM TEXT ==========
function extractISBNFromText(text) {
    if (!text) return null;

    // Clean the text first - remove extra spaces
    text = text.replace(/\s+/g, ' ');

    // ISBN patterns - order matters, try most specific first
    const patterns = [
        // Pattern 1: ISBN: followed by 13 digits (with optional spaces/dashes)
        /ISBN[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/gi,

        // Pattern 2: ISBN: followed by 10 digits (with optional spaces/dashes)
        /ISBN[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/gi,

        // Pattern 3: 书号 followed by 13 digits
        /书号[:\s]*(\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d[\s\-]?\d)/g,

        // Pattern 4: Standalone 13-digit number starting with 978 or 979
        /(?:^|[^\d])(97[89]\d{10})(?:[^\d]|$)/g,

        // Pattern 5: Just look for ISBN followed by any digits
        /ISBN[:\s\-–—]*(\d+)/gi,
    ];

    for (const pattern of patterns) {
        const matches = text.matchAll(pattern);
        for (const match of matches) {
            // Get the captured group (the ISBN digits)
            let isbn = match[1];
            if (!isbn) continue;

            // Remove all non-digit characters
            isbn = isbn.replace(/\D/g, '');

            // Check if it's valid length
            if (isbn.length === 13 || isbn.length === 10) {
                console.log(`✓ Found ISBN in text: "${isbn}" from "${text.substring(0, 100)}..."`);
                return isbn;
            }
        }
    }

    console.log(`✗ No ISBN found in text: "${text.substring(0, 100)}..."`);
    return null;
}

function extractISBNFromTaobaoHTML(html) {
  const scripts = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts) return '';

  for (const script of scripts) {
    // Common ISBN patterns
    const m = script.match(/97[89][-\s]?\d{1,5}[-\s]?\d{1,7}[-\s]?\d{1,7}[-\s]?\d/);
    if (m) return m[0].replace(/[\s-]/g, '');
  }
  return '';
}

    // ========== TAOBAO ISBN EXTRACTION ==========
    // ========== MAIN EXTRACTION ROUTER ==========
    function extractOrderData() {
        const platform = getCurrentPlatform();
        if (platform === PLATFORM.DANGDANG) {
            return extractDangdangOrderData();
        } else if (platform === PLATFORM.TAOBAO) {
            return extractTaobaoOrderData();
        }
        return null;
    }

    // ========== ISBN FETCHING ==========
async function fetchISBNs(orderData, updateCallback) {
    const platform = orderData.platform;

    for (let i = 0; i < orderData.items.length; i++) {
        const item = orderData.items[i];

        try {  // <-- ADD THIS
            if (updateCallback) {
                updateCallback(i + 1, orderData.items.length, item.name);
            }

            if (platform === PLATFORM.DANGDANG) {
                // Dangdang API
                const apiEndpoint = 'https://unbound-backend.azurewebsites.net/api/ScrapeDangdang';
                const data = await new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        method: 'GET',
                        url: `${apiEndpoint}?url=${encodeURIComponent(item.url)}`,
                        onload: function(response) {
                            if (response.status === 200) {
                                try {
                                    const jsonData = JSON.parse(response.responseText);
                                    resolve(jsonData);
                                } catch (e) {
                                    reject(new Error('Failed to parse JSON'));
                                }
                            } else {
                                reject(new Error(`HTTP ${response.status}`));  // <-- FIX: Changed Error` to Error(`
                            }
                        },
                        onerror: function(error) {
                            reject(new Error('Network error'));
                        },
                        ontimeout: function() {
                            reject(new Error('Timeout'));
                        },
                        timeout: 10000
                    });
                });

                item.isbn = data.isbn || '';
                if (data.title && data.title !== item.name) {
                    item.apiTitle = data.title;
                }
            } else if (platform === PLATFORM.TAOBAO) {
                // Skip automatic fetching - use semi-automatic extraction instead
                if (!item.isbn) {
                    console.log(`⚠️  ${item.name.substring(0, 40)}... - needs semi-automatic extraction`);  // <-- FIX: Changed console.log` to console.log(`
                }
                // Don't try to fetch - will be handled by semi-automatic extraction
            }
        } catch (error) {  // <-- ADD THIS
            console.error(`Failed to fetch ISBN for ${item.url}:`, error);
            item.isbn = 'ERROR';
        }  // <-- ADD THIS
    }

    return orderData;
}    function formatForGoogleSheets(orderData) {
        // Format: ISBN, Product Name, Quantity, Unit Price, Subtotal, Tags, Language, URL, Package Number
        let output = '';

        orderData.items.forEach(item => {
            output += `${item.isbn}\t${item.name}\t${item.quantity}\t${item.unitPrice}\t${item.subtotal}\t\t\t${item.url}\t${orderData.packageNumber || ''}\n`;
        });

        return output;
    }

    function createDataForAPI(orderData) {
        const apiData = orderData.items.map(item => {
            return {
                isbn: item.isbn,
                url: item.url,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                subtotal: item.subtotal,
                productName: item.name,
                packageNumber: orderData.packageNumber || '',
                platform: orderData.platform
            };
        });

        return apiData;
    }

    async function showModal(orderData, isRefresh = false) {
        showLoadingModal(orderData);
        await fetchISBNs(orderData, updateLoadingProgress);
        hideLoadingModal();
        showResultsModal(orderData);
    }

    function updateLoadingProgress(current, total, itemName) {
        const progressText = document.getElementById('loading-progress-text');
        const progressBar = document.getElementById('loading-progress-bar');
        const progressItem = document.getElementById('loading-current-item');

        if (progressText) {
            progressText.textContent = `正在处理: ${current} / ${total}`;
        }
        if (progressBar) {
            const percentage = (current / total) * 100;
            progressBar.style.width = percentage + '%';
        }
        if (progressItem) {
            progressItem.textContent = itemName.length > 50 ? itemName.substring(0, 50) + '...' : itemName;
        }
    }

    function showLoadingModal(orderData) {
        const overlay = document.createElement('div');
        overlay.id = 'dd-export-overlay';

        const modal = document.createElement('div');
        modal.id = 'dd-export-modal';

        const platformBadge = orderData.platform === PLATFORM.DANGDANG
            ? '<span class="platform-badge platform-dangdang">当当</span>'
            : '<span class="platform-badge platform-taobao">淘宝</span>';

        modal.innerHTML = `
            <div class="modal-title">正在获取ISBN信息...${platformBadge}</div>
            <div class="order-info-display">
                <div><strong>订单号:</strong> ${orderData.orderNumber}</div>
                ${orderData.packageNumber ? `<div><strong>包裹号:</strong> ${orderData.packageNumber}</div>` : ''}
                ${orderData.sellerName ? `<div><strong>卖家:</strong> ${orderData.sellerName}</div>` : ''}
                <div><strong>商品数量:</strong> ${orderData.items.length}</div>
            </div>
            <div style="text-align: center; padding: 30px;">
                <div style="font-size: 14px; color: #666; margin-bottom: 10px;" id="loading-progress-text">正在准备...</div>
                <div style="width: 100%; height: 20px; background: #f0f0f0; border-radius: 10px; overflow: hidden; margin-bottom: 15px;">
                    <div id="loading-progress-bar" style="height: 100%; background: linear-gradient(90deg, #ff2832, #ff5842); width: 0%; transition: width 0.3s;"></div>
                </div>
                <div style="font-size: 12px; color: #999;" id="loading-current-item">
                    ${orderData.platform === PLATFORM.TAOBAO ? '淘宝ISBN获取功能不稳定，小心使用' : '正在从API获取ISBN信息，请稍候...'}
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);
    }

    function hideLoadingModal() {
        const modal = document.getElementById('dd-export-modal');
        const overlay = document.getElementById('dd-export-overlay');
        if (modal) document.body.removeChild(modal);
        if (overlay) document.body.removeChild(overlay);
    }

    function showResultsModal(orderData) {
        const overlay = document.createElement('div');
        overlay.id = 'dd-export-overlay';

        const modal = document.createElement('div');
        modal.id = 'dd-export-modal';

        const tsvData = formatForGoogleSheets(orderData);
        const jsonData = JSON.stringify(createDataForAPI(orderData), null, 2);

        const errorCount = orderData.items.filter(item => item.isbn === 'ERROR').length;
        const missingCount = orderData.items.filter(item => !item.isbn || item.isbn === '').length;
        const successCount = orderData.items.filter(item => item.isbn && item.isbn !== 'ERROR').length;

        let itemsList = '';
        orderData.items.forEach((item, index) => {
            const isbnStatus = item.isbn === 'ERROR' ? '❌ 获取失败' : (item.isbn ? `✅ ${item.isbn}` : '⚠️ 未找到');
            const statusColor = item.isbn === 'ERROR' ? '#f5222d' : (item.isbn ? '#52c41a' : '#faad14');
            const packageInfo = item.packageName ? `<span style="color: #999; font-size: 11px;">[${item.packageName}]</span> ` : '';
            itemsList += `<div style="padding: 8px; border-bottom: 1px solid #eee; background: ${index % 2 === 0 ? '#fff' : '#fafafa'};">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div style="flex: 1;">
                        <div style="font-weight: bold; font-size: 13px;">${packageInfo}${index + 1}. ${item.name}</div>
                        <div style="font-size: 11px; color: #999; margin-top: 2px;">数量: ${item.quantity} | 单价: ¥${item.unitPrice} | 小计: ¥${item.subtotal}</div>
                    </div>
                    <div style="font-size: 12px; color: ${statusColor}; white-space: nowrap; margin-left: 10px;">
                        ${isbnStatus}
                    </div>
                </div>
            </div>`;
        });

        let summaryHtml = '';
        if (errorCount > 0 || missingCount > 0) {
            summaryHtml = `<div style="background: #fff7e6; border: 1px solid #ffd591; border-radius: 4px; padding: 10px; margin-bottom: 15px;">
                <div style="font-weight: bold; color: #fa8c16; margin-bottom: 5px;">📊 获取结果统计</div>
                <div style="font-size: 12px; color: #666;">
                    成功: ${successCount} | 失败: ${errorCount} | 未找到: ${missingCount}
                </div>
                ${errorCount > 0 && orderData.platform === PLATFORM.DANGDANG ? '<div style="font-size: 11px; color: #f5222d; margin-top: 5px;">⚠️ 有失败项目，可以点击"🔄 重新获取失败项"按钮重试</div>' : ''}
                ${orderData.platform === PLATFORM.TAOBAO ? '<div style="font-size: 11px; color: #1890ff; margin-top: 5px;">ℹ️ 淘宝ISBN获取功能不稳定，小心使用</div>' : ''}
            </div>`;
        }

        const platformBadge = orderData.platform === PLATFORM.DANGDANG
            ? '<span class="platform-badge platform-dangdang">当当</span>'
            : '<span class="platform-badge platform-taobao">淘宝</span>';

        modal.innerHTML = `
            <div class="modal-title">导出订单数据${platformBadge}</div>
            <div class="order-info-display">
                <div><strong>订单号:</strong> ${orderData.orderNumber}</div>
                ${orderData.packageNumber ? `<div><strong>包裹号:</strong> ${orderData.packageNumber}</div>` : ''}
                ${orderData.sellerName ? `<div><strong>卖家:</strong> ${orderData.sellerName}</div>` : ''}
                <div><strong>商品数量:</strong> ${orderData.items.length}</div>
                <div><strong>总金额:</strong> ￥${orderData.items.reduce((sum, item) => sum + parseFloat(item.subtotal || 0), 0).toFixed(2)}</div>
            </div>
            ${summaryHtml}
            <div style="max-height: 200px; overflow-y: auto; margin-bottom: 15px; border: 1px solid #e8e8e8; border-radius: 4px;">
                ${itemsList}
            </div>
            <div class="modal-content">
                <div style="margin-bottom: 10px; font-weight: bold;">方式1: 复制到Google Sheets (TSV格式)</div>
                <textarea class="modal-textarea" id="tsv-output" readonly>${tsvData}</textarea>
            </div>
            <div class="modal-content">
                <div style="margin-bottom: 10px; font-weight: bold;">方式2: JSON格式 (用于API)</div>
                <textarea class="modal-textarea" id="json-output" readonly>${jsonData}</textarea>
            </div>

          <div class="modal-buttons">
    ${orderData.platform === PLATFORM.TAOBAO && missingCount > 0 ? '<button class="modal-btn modal-btn-secondary" id="semi-auto-btn">🤖 半自动提取ISBN</button>' : ''}
    ${errorCount > 0 && orderData.platform === PLATFORM.DANGDANG ? '<button class="modal-btn modal-btn-secondary" id="retry-failed-btn">🔄 重新获取失败项</button>' : ''}
    ${orderData.platform === PLATFORM.DANGDANG ? '<button class="modal-btn modal-btn-secondary" id="retry-all-btn">🔄 全部重新获取</button>' : ''}
    <button class="modal-btn modal-btn-secondary" id="copy-tsv-btn">复制TSV格式</button>
    <button class="modal-btn modal-btn-secondary" id="copy-json-btn">复制JSON格式</button>
                <button class="modal-btn modal-btn-primary" id="close-modal-btn">关闭</button>
            </div>
        `;

        document.body.appendChild(overlay);
        document.body.appendChild(modal);

        document.getElementById('close-modal-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
        });

        document.getElementById('copy-tsv-btn').addEventListener('click', () => {
            GM_setClipboard(tsvData);
            alert('TSV格式已复制到剪贴板！\n\n可以直接粘贴到Google Sheets的"书单"工作表中。\n格式包含: ISBN, 商品名称, 数量, 单价, 小计, 标签, 语言, URL, 包裹号');
        });

        document.getElementById('copy-json-btn').addEventListener('click', () => {
            GM_setClipboard(jsonData);
            alert('JSON格式已复制到剪贴板！');
        });

        if (errorCount > 0 && orderData.platform === PLATFORM.DANGDANG) {
            document.getElementById('retry-failed-btn').addEventListener('click', async () => {
                document.body.removeChild(modal);
                document.body.removeChild(overlay);

                const failedOrderData = {
                    orderNumber: orderData.orderNumber,
                    packageNumber: orderData.packageNumber,
                    platform: orderData.platform,
                    items: orderData.items.filter(item => item.isbn === 'ERROR')
                };

                showLoadingModal(orderData);
                await fetchISBNs(failedOrderData, updateLoadingProgress);

                failedOrderData.items.forEach(retriedItem => {
                    const originalItem = orderData.items.find(item => item.url === retriedItem.url);
                    if (originalItem) {
                        originalItem.isbn = retriedItem.isbn;
                    }
                });

                hideLoadingModal();
                showResultsModal(orderData);
            });
        }

        if (orderData.platform === PLATFORM.DANGDANG) {
            document.getElementById('retry-all-btn').addEventListener('click', async () => {
                document.body.removeChild(modal);
                document.body.removeChild(overlay);

                orderData.items.forEach(item => {
                    item.isbn = '';
                });

                await showModal(orderData, true);
            });
        }
// Add semi-automatic extraction button handler for Taobao
if (orderData.platform === PLATFORM.TAOBAO) {
    const semiAutoBtn = document.getElementById('semi-auto-btn');
    if (semiAutoBtn) {
        semiAutoBtn.addEventListener('click', () => {
            // Store orderData globally so we can access it after extraction
            window.currentOrderData = orderData;

            document.body.removeChild(modal);
            document.body.removeChild(overlay);
            startSemiAutomaticExtraction(orderData);
        });
    }
}
        overlay.addEventListener('click', () => {
            document.body.removeChild(modal);
            document.body.removeChild(overlay);
        });
    }
// ========== SEMI-AUTOMATIC TAOBAO ISBN EXTRACTION ==========

function startSemiAutomaticExtraction(orderData) {
    // Only queue items WITHOUT ISBN
    isbnExtractionQueue = orderData.items
        .map((item, index) => ({
            index: index,
            url: item.url,
            name: item.name,
            hasISBN: !!item.isbn
        }))
        .filter(item => !item.hasISBN);

    currentQueueIndex = 0;
    extractedISBNs = {};
    openedWindows = [];

    // Count how many already have ISBNs
    const alreadyHasISBN = orderData.items.filter(item => item.isbn).length;

    if (isbnExtractionQueue.length === 0) {
        alert(`✓ 所有商品都已从标题中提取到ISBN！\n\n已找到 ${alreadyHasISBN} 个ISBN，无需打开商品页面。`);
        return;
    }

    // Show extraction modal
    showExtractionProgressModal(orderData, alreadyHasISBN);

    // Start opening tabs
    openNextProductPage();
}

function openNextProductPage() {
    if (currentQueueIndex >= isbnExtractionQueue.length) {
        // All done!
        setTimeout(() => {
            closeAllOpenedWindows();
            completeExtraction();
        }, 3000);
        return;
    }

    const current = isbnExtractionQueue[currentQueueIndex];

    // Update progress
    updateExtractionProgress(currentQueueIndex + 1, isbnExtractionQueue.length, current.name);

    // Open product page in new tab with special flag
    const win = window.open(current.url + '&_isbn_extract=1', '_blank');
    if (win) {
        openedWindows.push(win);
    }

    // Move to next after delay
    setTimeout(() => {
        currentQueueIndex++;
        openNextProductPage();
    }, 5000); // 5 second delay between opening tabs
}

function closeAllOpenedWindows() {
    openedWindows.forEach(win => {
        try {
            if (win && !win.closed) {
                win.close();
            }
        } catch (e) {
            console.log('Could not close window:', e);
        }
    });
    openedWindows = [];
}

function showExtractionProgressModal(orderData, alreadyExtracted = 0) {
    const overlay = document.createElement('div');
    overlay.id = 'extraction-overlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); z-index: 999998;';

    const modal = document.createElement('div');
    modal.id = 'extraction-modal';
    modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: white;
        padding: 30px;
        border-radius: 12px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        z-index: 999999;
        min-width: 500px;
    `;

    const totalItems = orderData.items.length;
    const needsExtraction = isbnExtractionQueue.length;

    modal.innerHTML = `
        <div style="font-size: 18px; font-weight: bold; margin-bottom: 20px; color: #333;">
            🤖 正在批量提取ISBN
        </div>
        ${alreadyExtracted > 0 ? `
        <div style="background: #f6ffed; border: 1px solid #b7eb8f; border-radius: 6px; padding: 12px; margin-bottom: 15px;">
            <div style="font-size: 13px; color: #52c41a;">
                ✓ <strong>已从标题提取:</strong> ${alreadyExtracted} / ${totalItems}<br>
                <span style="font-size: 12px; opacity: 0.8;">这些商品无需打开页面</span>
            </div>
        </div>
        ` : ''}
        <div style="background: #f5f5f5; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
            <div style="margin-bottom: 10px;">
                <strong>需要访问页面:</strong> <span id="extraction-progress">0 / ${needsExtraction}</span>
            </div>
            <div style="width: 100%; height: 20px; background: #e8e8e8; border-radius: 10px; overflow: hidden;">
                <div id="extraction-bar" style="height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); width: 0%; transition: width 0.3s;"></div>
            </div>
            <div style="margin-top: 10px; font-size: 12px; color: #666;">
                当前: <span id="extraction-current">准备中...</span>
            </div>
        </div>
        <div style="background: #fff7e6; border: 1px solid #ffd591; border-radius: 6px; padding: 12px; margin-bottom: 15px;">
            <div style="font-size: 13px; color: #fa8c16;">
                ⚠️ <strong>说明:</strong><br>
                • 脚本会自动打开缺少ISBN的商品页面<br>
                • 请不要关闭新打开的标签页<br>
                • ISBN会自动提取并填充<br>
                • 完成后所有标签页会自动关闭
            </div>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px;">
            <button id="cancel-extraction-btn" style="padding: 8px 20px; background: #f0f0f0; border: none; border-radius: 4px; cursor: pointer;">取消</button>
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.appendChild(modal);

    document.getElementById('cancel-extraction-btn').addEventListener('click', () => {
        isbnExtractionQueue = [];
        closeAllOpenedWindows();
        document.body.removeChild(modal);
        document.body.removeChild(overlay);
    });
}

function updateExtractionProgress(current, total, itemName) {
    const progressText = document.getElementById('extraction-progress');
    const progressBar = document.getElementById('extraction-bar');
    const currentItem = document.getElementById('extraction-current');

    if (progressText) {
        progressText.textContent = `${current} / ${total}`;
    }
    if (progressBar) {
        const percentage = (current / total) * 100;
        progressBar.style.width = percentage + '%';
    }
    if (currentItem) {
        currentItem.textContent = itemName.length > 60 ? itemName.substring(0, 60) + '...' : itemName;
    }
}

function completeExtraction() {
    // Merge extracted ISBNs back into orderData
    const globalOrderData = window.currentOrderData;
    if (globalOrderData) {
        globalOrderData.items.forEach(item => {
            const cleanUrl = item.url.split('&_isbn_extract')[0].split('?')[0];
            Object.keys(extractedISBNs).forEach(extractedUrl => {
                const extractedClean = extractedUrl.split('&_isbn_extract')[0].split('?')[0];
                if (cleanUrl.includes(extractedClean) || extractedClean.includes(cleanUrl)) {
                    item.isbn = extractedISBNs[extractedUrl];
                }
            });
        });
    }

    const totalItems = globalOrderData ? globalOrderData.items.length : 0;
    const successCount = globalOrderData ? globalOrderData.items.filter(item => item.isbn && item.isbn !== 'ERROR').length : Object.keys(extractedISBNs).length;
    const missingCount = globalOrderData ? globalOrderData.items.filter(item => !item.isbn || item.isbn === '').length : 0;

    const modal = document.getElementById('extraction-modal');
    if (modal) {
        modal.innerHTML = `
            <div style="text-align: center; padding: 20px;">
                <div style="font-size: 48px; margin-bottom: 20px;">✓</div>
                <div style="font-size: 18px; font-weight: bold; color: #52c41a; margin-bottom: 20px;">
                    提取完成!
                </div>
                <div style="font-size: 14px; color: #666; margin-bottom: 20px;">
                    总计: ${totalItems} 个商品<br>
                    成功: ${successCount} 个<br>
                    ${missingCount > 0 ? `未找到: ${missingCount} 个` : ''}
                </div>
                <button id="close-extraction-btn" style="padding: 10px 30px; background: #52c41a; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">
                    查看结果
                </button>
            </div>
        `;

        document.getElementById('close-extraction-btn').addEventListener('click', () => {
            document.body.removeChild(modal);
            const overlay = document.getElementById('extraction-overlay');
            if (overlay) document.body.removeChild(overlay);

            // Show the results modal with updated data
            if (globalOrderData) {
                showResultsModal(globalOrderData);
            }
        });
    }
}

// Listen for ISBN data from product pages
window.addEventListener('message', function(event) {
    if (event.data.type === 'TAOBAO_ISBN_FOUND') {
        const { url, isbn } = event.data;
        extractedISBNs[url] = isbn;
        console.log('✓ Received ISBN:', isbn, 'for', url);
    }
});

    function addExportButton() {
        const platform = getCurrentPlatform();
        if (!platform) return;

        const button = document.createElement('button');
        button.id = 'dd-export-btn';
        button.textContent = platform === PLATFORM.DANGDANG ? '📋 导出订单 (当当)' : '📋 导出订单 (淘宝)';
        button.addEventListener('click', async () => {
            const orderData = extractOrderData();
            if (!orderData || orderData.items.length === 0) {
                alert('未找到订单数据！请确保页面已完全加载。');
                return;
            }
            await showModal(orderData);
        });
        document.body.appendChild(button);
    }

    // Wait for the page to load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addExportButton);
    } else {
        addExportButton();
    }

    // Instructions in console
    const platform = getCurrentPlatform();
    if (platform === PLATFORM.DANGDANG) {
        console.log('%c当当订单导出脚本已加载', 'color: #ff2832; font-size: 16px; font-weight: bold;');
    } else if (platform === PLATFORM.TAOBAO) {
        console.log('%c淘宝订单导出脚本已加载', 'color: #ff6600; font-size: 16px; font-weight: bold;');
    }
    console.log('%c点击右侧的"📋 导出订单"按钮来导出订单数据', 'color: #333; font-size: 12px;');
    console.log('%c使用说明:', 'color: #333; font-size: 12px; font-weight: bold;');
    console.log('1. TSV格式: 可以直接粘贴到Google Sheets');
    console.log('2. JSON格式: 包含完整的URL和数据，可用于API调用');
    if (platform === PLATFORM.TAOBAO) {
        console.log('%c注意: 淘宝ISBN获取功能不稳定，小心使用', 'color: #ff6600; font-size: 12px;');
    }
})();
