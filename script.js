/**
 * REISEREGNING KALKULATOR 2026 — KOMPLETT, SIKRET OG ELEVANT
 * Statens satser for kjøregodtgjørelse, diett og utlegg.
 * Støtter både lokal offline-lagring og sky-synkronisering med Supabase.
 */

// --- 1. KONSTANTER & SATSER (2026) ---
const RATES = {
    km: 5.30,
    passenger: 1.00,
    diet: {
        stateDay6to12: 397,
        stateOver12: 736,
        stateDognite: 1012,
        taxfreeDay6to12: 200,
        taxfreeOver12: 400,
        taxfreeHotel: 693,
        taxfreeBoarding: 400,
        taxfreePrivate: 107
    }
};

const currencyFormatter = new Intl.NumberFormat('no-NO', {
    style: 'currency',
    currency: 'NOK',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const LOCAL_STORAGE_KEY = 'reiseregning_saved_trips_v2';
let currentWorkspaceMode = 'privatperson';

// Supabase Initialization
const supabaseUrl = 'https://yfanegpwyjqhkbiikfny.supabase.co';
const supabaseKey = 'sb_publishable_G8uHOPVInNnMvm6rSjWB5g_QjeHyhY-';
const supabaseClient = window.supabase ? window.supabase.createClient(supabaseUrl, supabaseKey) : null;

// State management
let canvasHasContent = false;
let uploadedReceipts = [];
let currentUser = null;
let currentCompany = null; // { company_id, role, company_name, join_code }

// --- HJELPEFUNKSJONER (SIKKERHET & PARSING) ---
function escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/[&<>'"]/g, match => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[match] || match));
}

function parseNum(val) {
    if (!val) return 0;
    const parsed = parseFloat(String(val).replace(/\s/g, '').replace(',', '.'));
    return isNaN(parsed) ? 0 : parsed;
}

// --- 2. INITIALISERING ---
document.addEventListener('DOMContentLoaded', () => {
    // Set default final-date-place
    const todayFormatted = new Date().toLocaleDateString('no-NO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const finalDatePlace = document.getElementById('final-date-place');
    if (finalDatePlace && !finalDatePlace.value) {
        finalDatePlace.value = `Oslo, ${todayFormatted}`;
    }

    addMileageRow();
    addExpenseRow();
    initCanvas();

    flatpickr(".flatpickr-datetime", {
        enableTime: true,
        time_24hr: true,
        dateFormat: "Y-m-d H:i",
        altInput: true,
        altFormat: "d.m.Y k\\l. H:i",
        locale: "no",
        onChange: () => calculateAll(),
        onClose: () => calculateAll()
    });
    
    loadPersonalInfo();
    
    // Auth State Initialization
    if (supabaseClient && typeof initAuth === 'function') {
        try {
            initAuth(supabaseClient, (user) => {
                currentUser = user;
                updateAuthUI();
            });
        } catch (e) {
            console.warn("Auth initialization skipped (offline/local mode)", e);
        }
    }

    updateWorkspaceUI();

    const form = document.getElementById('expense-form');
    if (form) {
        form.addEventListener('input', calculateAll);
        form.addEventListener('change', calculateAll);
    }

    // Check if we need to load a trip from localStorage
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('load') === 'true') {
        const tempTrip = localStorage.getItem('tempLoadTrip');
        if (tempTrip) {
            try {
                loadTrip(tempTrip);
                localStorage.removeItem('tempLoadTrip');
                window.history.replaceState({}, document.title, window.location.pathname);
            } catch (e) {
                console.error('Error loading temp trip:', e);
            }
        }
    }
});

// --- WORKSPACE & AUTH UI ---
function setWorkspaceMode(mode) {
    currentWorkspaceMode = 'privatperson';
}

function updateWorkspaceUI() {
    // Bedriftsportal er deaktivert; appen kjører rent for reiseregning
    currentWorkspaceMode = 'privatperson';
}

async function signUp() {
    if (!supabaseClient) {
        showToast("Supabase er ikke tilgjengelig. Bruk lokal lagring.", "info");
        return;
    }
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-message');
    const btn = document.getElementById('btn-signup');

    setLoadingState(btn, true);

    if (!email || !password) {
        msg.textContent = "Fyll inn e-post og passord.";
        setLoadingState(btn, false);
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) {
            msg.textContent = error.message;
        } else {
            msg.style.color = "var(--success-color)";
            msg.textContent = "Sjekk innboksen for bekreftelses-e-post, eller logg inn.";
        }
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        setLoadingState(btn, false);
    }
}

async function logIn() {
    if (!supabaseClient) {
        showToast("Supabase er ikke tilgjengelig.", "info");
        return;
    }
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-message');
    const btn = document.getElementById('btn-login');

    setLoadingState(btn, true);

    if (!email || !password) {
        msg.textContent = "Fyll inn e-post og passord.";
        setLoadingState(btn, false);
        return;
    }

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) {
            msg.style.color = "var(--danger-color)";
            msg.textContent = error.message;
        } else {
            msg.textContent = "";
            document.getElementById('auth-email').value = '';
            document.getElementById('auth-password').value = '';
            showToast("Logget inn!", "success");
        }
    } catch (err) {
        msg.textContent = err.message;
    } finally {
        setLoadingState(btn, false);
    }
}

async function logOut() {
    if (supabaseClient) {
        await supabaseClient.auth.signOut();
    }
    currentUser = null;
    updateAuthUI();
    showToast("Logget ut.", "info");
}

function toggleAuthPanel() {
    const wrapper = document.getElementById('auth-panel-wrapper');
    if (!wrapper) return;
    if (wrapper.style.display === 'none' || !wrapper.style.display) {
        wrapper.style.display = 'block';
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
        wrapper.style.display = 'none';
    }
}

function updateAuthUI() {
    const loggedOutDiv = document.getElementById('auth-logged-out');
    const loggedInDiv = document.getElementById('auth-logged-in');
    const userEmailSpan = document.getElementById('auth-user-email');
    const avatarDiv = document.getElementById('profile-avatar');
    const toggleLabel = document.getElementById('account-toggle-label');

    if (currentUser) {
        if (loggedOutDiv) loggedOutDiv.style.display = 'none';
        if (loggedInDiv) loggedInDiv.style.display = 'block';
        if (userEmailSpan) userEmailSpan.textContent = currentUser.email;

        if (avatarDiv) {
            avatarDiv.textContent = currentUser.email.substring(0, 2).toUpperCase();
        }
        if (toggleLabel) {
            toggleLabel.textContent = currentUser.email.split('@')[0];
        }
    } else {
        if (loggedOutDiv) loggedOutDiv.style.display = 'block';
        if (loggedInDiv) loggedInDiv.style.display = 'none';
        if (userEmailSpan) userEmailSpan.textContent = '';
        if (toggleLabel) {
            toggleLabel.textContent = "Konto";
        }
    }

    updateWorkspaceUI();
}

// --- 3. DYNAMISKE RADER ---
function addMileageRow(defaultData = {}) {
    const tbody = document.getElementById('mileage-body');
    const row = document.createElement('tr');
    
    row.innerHTML = `
        <td><input type="text" class="flatpickr-mileage" placeholder="Dato og tid"></td>
        <td><input type="text" class="from-input" placeholder="Fra..."></td>
        <td><input type="text" class="to-input" placeholder="Til..."></td>
        <td><input type="text" inputmode="decimal" class="km-input" value="${defaultData.km || '0'}" style="width: 70px;"></td>
        <td><input type="text" class="pass-name" placeholder="Navn på passasjer"></td>
        <td><input type="text" inputmode="decimal" class="toll-input" value="${defaultData.toll || '0'}" style="width: 80px;"></td>
        <td style="text-align: right; font-weight: 600;" class="stage-sum">0,00 kr</td>
        <td class="no-print" style="text-align: center;"><button type="button" class="btn-text btn-small" style="color:var(--danger-color); font-weight: 600;" onclick="removeRow(this)">Slett</button></td>
    `;
    tbody.appendChild(row);
    
    flatpickr(row.querySelector('.flatpickr-mileage'), {
        enableTime: true,
        time_24hr: true,
        dateFormat: "Y-m-d H:i",
        altInput: true,
        altFormat: "d.m.Y k\\l. H:i",
        locale: "no",
        defaultDate: defaultData.date || new Date(),
        onChange: () => calculateAll(),
        onClose: () => calculateAll()
    });

    if (defaultData.from) row.querySelector('.from-input').value = defaultData.from;
    if (defaultData.to) row.querySelector('.to-input').value = defaultData.to;
    if (defaultData.pass) row.querySelector('.pass-name').value = defaultData.pass;

    row.addEventListener('input', calculateAll);

    calculateAll();
}

function addReturnMileageRow() {
    const rows = document.querySelectorAll('#mileage-body tr');
    if (rows.length === 0) {
        addMileageRow();
        return;
    }
    const lastRow = rows[rows.length - 1];
    const fromVal = lastRow.querySelector('.from-input').value;
    const toVal = lastRow.querySelector('.to-input').value;
    const kmVal = lastRow.querySelector('.km-input').value;
    const tollVal = lastRow.querySelector('.toll-input').value;

    if (!fromVal && !toVal) {
        showToast("Fyll ut 'Fra' og 'Til' på forrige etappe først.", "info");
        return;
    }

    addMileageRow({
        from: toVal,
        to: fromVal,
        km: kmVal,
        toll: tollVal,
        date: new Date()
    });

    showToast("Returreise lagt til!", "success");
}

function addExpenseRow(defaultData = {}) {
    const tbody = document.getElementById('expenses-body');
    const row = document.createElement('tr');
    const today = defaultData.date || new Date().toISOString().split('T')[0];
    
    row.innerHTML = `
        <td><input type="text" class="flatpickr-date" value="${today}"></td>
        <td><input type="text" class="desc-input" placeholder="Beskrivelse (f.eks. Drosje, Parkering)" value="${defaultData.description || ''}"></td>
        <td><input type="text" inputmode="decimal" class="exp-amount" value="${defaultData.amount || '0'}" style="width: 100px;"></td>
        <td style="text-align:center;"><input type="checkbox" class="receipt-check" ${defaultData.receipt !== false ? 'checked' : ''} title="Kvittering vedlagt"></td>
        <td class="no-print" style="text-align: center;"><button type="button" class="btn-text btn-small" style="color:var(--danger-color); font-weight: 600;" onclick="removeRow(this)">Slett</button></td>
    `;
    tbody.appendChild(row);

    flatpickr(row.querySelector('.flatpickr-date'), {
        dateFormat: "Y-m-d",
        altInput: true,
        altFormat: "d.m.Y",
        locale: "no",
        onChange: () => calculateAll(),
        onClose: () => calculateAll()
    });

    row.addEventListener('input', calculateAll);

    calculateAll();
}

function removeRow(btn) {
    btn.closest('tr').remove();
    calculateAll();
}

// --- 4. HOVEDKALKULATOR ---
function calculateAll() {
    let totalMileage = 0;
    let totalOther = 0;

    document.querySelectorAll('#mileage-body tr').forEach(row => {
        const km = parseNum(row.querySelector('.km-input').value);
        const hasPassenger = row.querySelector('.pass-name').value.trim().length > 0;
        const toll = parseNum(row.querySelector('.toll-input').value);
        const legSum = (km * (hasPassenger ? RATES.km + RATES.passenger : RATES.km)) + toll;
        totalMileage += legSum;

        const sumCell = row.querySelector('.stage-sum');
        if (sumCell) {
            sumCell.textContent = currencyFormatter.format(legSum);
        }
    });

    document.querySelectorAll('.exp-amount').forEach(input => {
        totalOther += parseNum(input.value);
    });

    const diet = calculateDiet();
    
    const elMileage = document.getElementById('total-mileage');
    const elDiet = document.getElementById('total-diet');
    const elOther = document.getElementById('total-other');
    const elGrand = document.getElementById('grand-total');

    if (elMileage) elMileage.textContent = currencyFormatter.format(totalMileage);
    if (elDiet) elDiet.textContent = currencyFormatter.format(diet.amount);
    if (elOther) elOther.textContent = currencyFormatter.format(totalOther);
    if (elGrand) elGrand.textContent = currencyFormatter.format(totalMileage + diet.amount + totalOther);
    
    const dietSummary = document.getElementById('diet-summary');
    if (dietSummary) {
        dietSummary.textContent = diet.text;
    }

    const dietAmountDisplay = document.getElementById('diet-calc-amount');
    if (dietAmountDisplay) {
        dietAmountDisplay.textContent = currencyFormatter.format(diet.amount);
    }
}

function calculateDiet() {
    const startVal = document.getElementById('departure-date').value;
    const endVal = document.getElementById('return-date').value;
    const accType = document.getElementById('accommodation-type').value;
    const dietMode = document.getElementById('diet-mode').value;
    
    if (!startVal || !endVal) {
        return { amount: 0, text: "Fyll ut reisetid for diett-beregning." };
    }

    const startDate = new Date(startVal.includes(' ') ? startVal.replace(' ', 'T') : startVal);
    const endDate = new Date(endVal.includes(' ') ? endVal.replace(' ', 'T') : endVal);
    const diffHours = (endDate - startDate) / (1000 * 60 * 60);
    
    if (isNaN(diffHours) || diffHours <= 0) {
        return { amount: 0, text: "Hjemkomst må være etter avreise." };
    }

    const fullDays = Math.floor(diffHours / 24);
    const remainderHours = diffHours % 24;
    
    let totalBase = 0;
    let descParts = [];
    const isTaxfree = dietMode === 'taxfree';
    const modeLabel = isTaxfree ? 'Trekkfri sats' : 'Statens satser';

    let nightRate = 0;
    if (accType !== 'none') {
        if (isTaxfree) {
            nightRate = accType === 'hotel' ? RATES.diet.taxfreeHotel : 
                       (accType === 'boarding' ? RATES.diet.taxfreeBoarding : RATES.diet.taxfreePrivate);
        } else {
            nightRate = RATES.diet.stateDognite;
        }
    }

    const dayRate6to12 = isTaxfree ? RATES.diet.taxfreeDay6to12 : RATES.diet.stateDay6to12;
    const dayRateOver12 = isTaxfree ? RATES.diet.taxfreeOver12 : RATES.diet.stateOver12;

    if (fullDays > 0) {
        let rateToUse = accType !== 'none' ? nightRate : dayRateOver12;
        totalBase += fullDays * rateToUse;
        descParts.push(`${fullDays} fulle døgn (${currencyFormatter.format(rateToUse)}/døgn)`);
    }

    if (remainderHours >= 6) {
        let remainderRate = remainderHours <= 12 ? dayRate6to12 : dayRateOver12;
        totalBase += remainderRate;
        descParts.push(`overskytende ${Math.floor(remainderHours)}t (${currencyFormatter.format(remainderRate)})`);
    }

    if (totalBase === 0) {
        return { amount: 0, text: `Ingen diett. Reisetid under 6 timer (${modeLabel}).` };
    }

    let mealDeductionPercentage = 0;
    document.querySelectorAll('.meal-check:checked').forEach(cb => {
        mealDeductionPercentage += parseFloat(cb.dataset.percent);
    });
    
    const mealDeductionAmount = totalBase * mealDeductionPercentage;
    const finalAmount = Math.max(0, totalBase - mealDeductionAmount);
    
    const descText = `${descParts.join(' og ')} · ${modeLabel}`;
    return {
        amount: finalAmount,
        baseAmount: totalBase,
        deductionAmount: mealDeductionAmount,
        text: `${descText}. Grunnlag: ${currencyFormatter.format(totalBase)}.${mealDeductionPercentage > 0 ? ` Fratrekk: -${currencyFormatter.format(mealDeductionAmount)} (${Math.round(mealDeductionPercentage * 100)}%).` : ''}`
    };
}

// --- 5. SIGNATUR OG VEDLEGG ---
function initCanvas() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let drawing = false;

    // Retina display support
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = (rect.width || 600) * dpr;
    canvas.height = (rect.height || 150) * dpr;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const getPos = (e) => {
        const r = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { 
            x: clientX - r.left, 
            y: clientY - r.top 
        };
    };

    const start = (e) => {
        drawing = true;
        canvasHasContent = true;
        const p = getPos(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
    };

    const stop = () => { drawing = false; };
    const move = (e) => { 
        if (!drawing) return; 
        const p = getPos(e); 
        ctx.lineTo(p.x, p.y); 
        ctx.stroke(); 
    };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    canvas.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
}

function clearCanvas() {
    const canvas = document.getElementById('sig-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
    canvasHasContent = false;
    
    const preview = document.getElementById('sig-preview-container');
    if (preview) preview.innerHTML = '';
    
    const uploadInput = document.getElementById('sig-upload');
    if (uploadInput) uploadInput.value = '';
}

function switchTab(tab) {
    const drawTab = document.getElementById('draw-tab');
    const uploadTab = document.getElementById('upload-tab');
    if (drawTab) drawTab.style.display = tab === 'draw' ? 'block' : 'none';
    if (uploadTab) uploadTab.style.display = tab === 'upload' ? 'block' : 'none';
    document.querySelectorAll('.tab-btn').forEach((b, i) => {
        b.classList.toggle('active', (i === 0 && tab === 'draw') || (i === 1 && tab === 'upload'));
    });
}

function handleSignatureUpload(event) {
    const file = event.target.files[0];
    const preview = document.getElementById('sig-preview-container');
    if (!preview) return;

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `<img src="${escapeHTML(e.target.result)}" style="max-width: 100%; max-height: 80px; object-fit: contain; border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 5px;">`;
        };
        reader.readAsDataURL(file);
    } else {
        preview.innerHTML = '';
    }
}

function handleReceiptUploads(event) {
    const files = event.target.files;
    const container = document.getElementById('receipt-preview-container');
    if (!files || !container) return;
    
    Array.from(files).forEach((file) => {
        if (!file.type.startsWith('image/')) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            uploadedReceipts.push(dataUrl);
            
            const wrapper = document.createElement('div');
            wrapper.style.position = 'relative';
            wrapper.style.display = 'inline-block';
            
            wrapper.innerHTML = `
                <img src="${escapeHTML(dataUrl)}" style="height: 85px; width: 85px; object-fit: cover; border: 1px solid var(--border-color); border-radius: var(--radius-md); box-shadow: var(--shadow-xs);">
                <button type="button" class="btn-text" style="position: absolute; top: -6px; right: -6px; background: var(--danger-color); color: white; border-radius: 50%; width: 22px; height: 22px; font-size: 13px; padding: 0; line-height: 22px; text-align: center; border: 2px solid white; cursor: pointer;" onclick="removeReceipt(this, ${uploadedReceipts.length - 1})">&times;</button>
            `;
            container.appendChild(wrapper);
        };
        reader.readAsDataURL(file);
    });

    showToast(`${files.length} kvittering(er) lagt til!`, "success");
}

function removeReceipt(btn, index) {
    uploadedReceipts.splice(index, 1);
    btn.parentElement.remove();
}

// --- 6. FORHÅNDSVISNING OG PDF ---
function collectFormData() {
    return {
        personalInfo: {
            company: document.getElementById('emp-company') ? document.getElementById('emp-company').value : '',
            name: document.getElementById('emp-name') ? document.getElementById('emp-name').value : '',
            id: document.getElementById('emp-id') ? document.getElementById('emp-id').value : '',
            department: document.getElementById('emp-dept') ? document.getElementById('emp-dept').value : '',
            address: document.getElementById('emp-addr') ? document.getElementById('emp-addr').value : '',
            account: document.getElementById('emp-account') ? document.getElementById('emp-account').value : ''
        },
        travelInfo: {
            purpose: document.getElementById('travel-purpose') ? document.getElementById('travel-purpose').value : '',
            event: document.getElementById('travel-event') ? document.getElementById('travel-event').value : '',
            departure: document.getElementById('departure-date') ? document.getElementById('departure-date').value : '',
            return: document.getElementById('return-date') ? document.getElementById('return-date').value : '',
            accommodation: document.getElementById('accommodation-type') ? document.getElementById('accommodation-type').value : 'hotel',
            accommodationName: document.getElementById('accommodation-name') ? document.getElementById('accommodation-name').value : '',
            dietMode: document.getElementById('diet-mode') ? document.getElementById('diet-mode').value : 'state'
        },
        mileage: Array.from(document.querySelectorAll('#mileage-body tr')).map(r => ({ 
            date: r.querySelector('.flatpickr-mileage') ? r.querySelector('.flatpickr-mileage').value : '', 
            from: r.querySelector('.from-input') ? r.querySelector('.from-input').value : '', 
            to: r.querySelector('.to-input') ? r.querySelector('.to-input').value : '', 
            km: parseNum(r.querySelector('.km-input') ? r.querySelector('.km-input').value : 0), 
            passenger: r.querySelector('.pass-name') ? r.querySelector('.pass-name').value.trim() : '', 
            toll: parseNum(r.querySelector('.toll-input') ? r.querySelector('.toll-input').value : 0) 
        })),
        expenses: Array.from(document.querySelectorAll('#expenses-body tr')).map(r => ({ 
            date: r.querySelector('.flatpickr-date') ? r.querySelector('.flatpickr-date').value : '', 
            description: r.querySelector('.desc-input') ? r.querySelector('.desc-input').value : '', 
            amount: parseNum(r.querySelector('.exp-amount') ? r.querySelector('.exp-amount').value : 0), 
            receipt: r.querySelector('.receipt-check') ? r.querySelector('.receipt-check').checked : true 
        })),
        receipts: uploadedReceipts,
        signatureContent: canvasHasContent && document.getElementById('sig-canvas') ? document.getElementById('sig-canvas').toDataURL() : null,
        finalDatePlace: document.getElementById('final-date-place') ? document.getElementById('final-date-place').value : ''
    }; 
}

function previewExpenseReport() {
    const data = collectFormData();
    if (!data.personalInfo.name || !data.travelInfo.purpose) {
        showToast("Vennligst fyll ut navn og formål før forhåndsvisning.", "error");
        return;
    }

    const diet = calculateDiet();
    let totalM = data.mileage.reduce((sum, i) => sum + (i.km * (i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km)) + i.toll, 0);
    let totalE = data.expenses.reduce((sum, i) => sum + i.amount, 0);
    let grandTotal = totalM + diet.amount + totalE;

    let sigImg = "";
    const uploadedSig = document.querySelector('#sig-preview-container img');
    if (uploadedSig) {
        sigImg = `<img src="${escapeHTML(uploadedSig.src)}" style="max-height: 60px; width: auto; object-fit: contain;">`;
    } else if (data.signatureContent) {
        sigImg = `<img src="${escapeHTML(data.signatureContent)}" style="max-height: 60px; width: auto; object-fit: contain;">`;
    }

    const companyHeader = `<div style="text-align:right">
        <h3 style="margin: 0; color: #0f172a;">${escapeHTML(data.personalInfo.company) || 'Reiseregning'}</h3>
        <p style="margin: 2px 0 0 0; color: #64748b; font-size: 0.85rem;">Ref / Ansattnr: ${escapeHTML(data.personalInfo.id) || '-'}</p>
        <p style="margin: 2px 0 0 0; color: #64748b; font-size: 0.85rem;">Avdeling: ${escapeHTML(data.personalInfo.department) || '-'}</p>
        ${data.personalInfo.account ? `<p style="margin: 2px 0 0 0; color: #0f172a; font-weight: 600; font-size: 0.85rem;">Kontonr: ${escapeHTML(data.personalInfo.account)}</p>` : ''}
    </div>`;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay preview-modal-overlay';
    
    modal.innerHTML = `
        <div class="modal-content preview-modal-content">
            <div class="modal-header no-print">
                <h2>Forhåndsvisning av Reiseregning</h2>
                <div class="action-group">
                    <button type="button" class="btn btn-outline" onclick="exportToCSV()">Last ned CSV</button>
                    <button type="button" class="btn btn-primary" onclick="window.print()">Skriv ut / PDF</button>
                    <button type="button" class="btn btn-success" onclick="closeModal(); openSendToAccountantModal();" title="Send reiseregningen ferdig spesifisert til regnskapsfører">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        Send til regnskap
                    </button>
                    <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
                </div>
            </div>
            <div class="modal-body" id="preview-content">
                <div class="expense-report-document">
                    <div class="document-header">
                        <div>
                            <h1>REISEREGNING 2026</h1>
                            <p style="color: #64748b; font-size: 0.88rem; margin: 0;">Beregnet etter Statens satser</p>
                        </div>
                        ${companyHeader}
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; padding: 14px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                        <div>
                            <span class="doc-meta-label">Ansattinformasjon</span>
                            <p style="margin: 4px 0 0 0; font-weight: 700; color: #0f172a;">${escapeHTML(data.personalInfo.name)}</p>
                            <p style="margin: 2px 0 0 0; font-size: 0.88rem; color: #475569;">${escapeHTML(data.personalInfo.address) || 'Ingen adresse oppgitt'}</p>
                        </div>
                        <div>
                            <span class="doc-meta-label">Reiseopplysninger</span>
                            <p style="margin: 4px 0 0 0;"><strong>Formål:</strong> ${escapeHTML(data.travelInfo.purpose)}</p>
                            ${data.travelInfo.event ? `<p style="margin: 2px 0 0 0;"><strong>Arrangement:</strong> ${escapeHTML(data.travelInfo.event)}</p>` : ''}
                            <p style="margin: 2px 0 0 0; font-size: 0.88rem; color: #475569;">
                                <strong>Periode:</strong> ${escapeHTML(data.travelInfo.departure)} &ndash; ${escapeHTML(data.travelInfo.return)}
                            </p>
                            ${data.travelInfo.accommodationName ? `<p style="margin: 2px 0 0 0; font-size: 0.88rem; color: #475569;"><strong>Overnatting:</strong> ${escapeHTML(data.travelInfo.accommodationName)}</p>` : ''}
                        </div>
                    </div>

                    <!-- Diettseksjon -->
                    <div class="doc-section">
                        <div class="doc-section-title">Diettgodtgjørelse</div>
                        <div style="padding: 12px 14px; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 6px; margin-bottom: 16px;">
                            <p style="margin: 0; font-size: 0.92rem;"><strong>Spesifikasjon:</strong> ${escapeHTML(diet.text)}</p>
                            <p style="margin: 6px 0 0 0; font-weight: 700; color: #0f172a;">Sum diett: ${currencyFormatter.format(diet.amount)}</p>
                        </div>
                    </div>

                    <!-- Kjøring -->
                    ${data.mileage && data.mileage.length > 0 && data.mileage.some(m => m.km > 0) ? `
                    <div class="doc-section">
                        <div class="doc-section-title">Kjøregodtgjørelse (5,30 kr/km)</div>
                        <div class="table-responsive">
                            <table class="expense-table">
                                <thead>
                                    <tr>
                                        <th>Dato</th>
                                        <th>Rute (Fra &ndash; Til)</th>
                                        <th style="text-align: right;">Km</th>
                                        <th>Passasjer (+1 kr/km)</th>
                                        <th style="text-align: right;">Bom (kr)</th>
                                        <th style="text-align: right;">Sum etappe</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${data.mileage.map(i => {
                                        const routeSum = (i.km * (i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km)) + i.toll;
                                        return `
                                        <tr>
                                            <td>${escapeHTML(i.date)}</td>
                                            <td>${escapeHTML(i.from)} &ndash; ${escapeHTML(i.to)}</td>
                                            <td style="text-align: right;">${escapeHTML(i.km)} km</td>
                                            <td>${escapeHTML(i.passenger) || '-'}</td>
                                            <td style="text-align: right;">${currencyFormatter.format(i.toll)}</td>
                                            <td style="text-align: right; font-weight: 600;">${currencyFormatter.format(routeSum)}</td>
                                        </tr>`;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Andre Utlegg -->
                    ${data.expenses && data.expenses.length > 0 && data.expenses.some(e => e.amount > 0 || e.description) ? `
                    <div class="doc-section">
                        <div class="doc-section-title">Andre Utlegg</div>
                        <div class="table-responsive">
                            <table class="expense-table">
                                <thead>
                                    <tr>
                                        <th>Dato</th>
                                        <th>Beskrivelse</th>
                                        <th style="text-align: center;">Kvittering?</th>
                                        <th style="text-align: right;">Beløp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${data.expenses.map(e => `
                                        <tr>
                                            <td>${escapeHTML(e.date)}</td>
                                            <td>${escapeHTML(e.description)}</td>
                                            <td style="text-align: center;">${e.receipt ? 'Ja' : 'Nei'}</td>
                                            <td style="text-align: right; font-weight: 600;">${currencyFormatter.format(e.amount)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    ` : ''}

                    <!-- Total til utbetaling -->
                    <div class="summary-row">
                        <span>TOTALT TIL UTBETALING:</span>
                        <span style="font-family: 'JetBrains Mono', monospace; font-size: 1.35rem; color: #0f172a;">${currencyFormatter.format(grandTotal)}</span>
                    </div>

                    <!-- Signatur -->
                    <div class="signature-section" style="margin-top: 35px; display: flex; justify-content: space-between; align-items: flex-end; gap: 30px;">
                        <div>
                            <p style="font-size: 0.88rem; color: #64748b; margin-bottom: 4px;">Dato og sted:</p>
                            <p style="font-weight: 700; margin: 0;">${escapeHTML(data.finalDatePlace) || 'Sted og dato ikke fylt ut'}</p>
                        </div>
                        <div>
                            <div class="sig-box" style="display: flex; align-items: center; justify-content: center;">
                                ${sigImg || '<span style="color:#94a3b8; font-size:0.8rem;">[Uten signatur]</span>'}
                            </div>
                            <p style="font-size: 0.82rem; color: #475569; margin: 4px 0 0 0; text-align: center;">
                                ${escapeHTML(data.personalInfo.name)}
                            </p>
                        </div>
                    </div>

                    <!-- Kvitteringsvedlegg for print -->
                    ${data.receipts && data.receipts.length > 0 ? `
                    <div class="receipts-section" style="page-break-before: always; padding-top: 24px;">
                        <div class="doc-section-title">Vedlegg / Kvitteringer (${data.receipts.length} stk)</div>
                        <div style="display: flex; flex-direction: column; gap: 24px; align-items: center;">
                            ${data.receipts.map((src, idx) => `
                                <div style="text-align: center; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; max-width: 100%;">
                                    <p style="font-size: 0.8rem; color: #64748b; margin-bottom: 8px;">Kvitteringsvedlegg #${idx + 1}</p>
                                    <img src="${escapeHTML(src)}" style="max-width: 100%; max-height: 750px; object-fit: contain;">
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>
        </div>`;

    document.body.classList.add('modal-open');
    document.body.appendChild(modal);
}

function closeModal() {
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
    document.body.classList.remove('modal-open');
}

// --- 7. LAGRING: LOKALT & SKY ---
function savePersonalInfo() {
    const personalInfo = {
        company: document.getElementById('emp-company') ? document.getElementById('emp-company').value : '',
        name: document.getElementById('emp-name') ? document.getElementById('emp-name').value : '',
        id: document.getElementById('emp-id') ? document.getElementById('emp-id').value : '',
        department: document.getElementById('emp-dept') ? document.getElementById('emp-dept').value : '',
        address: document.getElementById('emp-addr') ? document.getElementById('emp-addr').value : '',
        account: document.getElementById('emp-account') ? document.getElementById('emp-account').value : ''
    };
    localStorage.setItem('personalInfo', JSON.stringify(personalInfo));
    showToast("Personopplysningene er lagret på denne enheten!", "success");
}

function loadPersonalInfo() {
    try {
        const saved = localStorage.getItem('personalInfo');
        if (saved) {
            const info = JSON.parse(saved);
            if (document.getElementById('emp-company')) document.getElementById('emp-company').value = info.company || '';
            if (document.getElementById('emp-name')) document.getElementById('emp-name').value = info.name || '';
            if (document.getElementById('emp-id')) document.getElementById('emp-id').value = info.id || '';
            if (document.getElementById('emp-dept')) document.getElementById('emp-dept').value = info.department || '';
            if (document.getElementById('emp-addr')) document.getElementById('emp-addr').value = info.address || '';
            if (document.getElementById('emp-account')) document.getElementById('emp-account').value = info.account || '';
        }
    } catch (e) {
        console.error("Feil ved innlasting av personinfo", e);
    }
}

// Lokal lagringsmotor
function getLocalSavedTrips() {
    try {
        const data = localStorage.getItem(LOCAL_STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.warn("Klarte ikke hente lokale reiser", e);
        return [];
    }
}

function saveLocalTrip(tripName, reportData) {
    const trips = getLocalSavedTrips();
    const newRecord = {
        id: 'local_' + Date.now(),
        trip_name: tripName,
        created_at: new Date().toISOString(),
        report_data: reportData,
        status: 'utkast'
    };
    trips.unshift(newRecord);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trips));
    return newRecord;
}

function deleteLocalTrip(id) {
    let trips = getLocalSavedTrips();
    trips = trips.filter(t => t.id !== id);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(trips));
}

async function saveExpenseReport(status = 'utkast') {
    const fullData = collectFormData();
    if (!fullData.personalInfo.name && !fullData.travelInfo.purpose) {
        showToast("Fyll ut minst navn eller formål før du lagrer.", "info");
        return;
    }

    let defaultName = `Reise ${new Date().toLocaleDateString('no-NO')}`;
    if (fullData.travelInfo.purpose) {
        defaultName = fullData.travelInfo.purpose.substring(0, 35);
    }

    const tripName = await showPrompt("Gi reisen et navn for enkel gjenkjenning:", defaultName);
    if (tripName === null) return; // User cancelled

    const btnSave = document.getElementById('btn-save-expense');
    if (btnSave) setLoadingState(btnSave, true);

    const diet = calculateDiet();
    let totalM = fullData.mileage.reduce((sum, i) => sum + (i.km * (i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km)) + i.toll, 0);
    let totalE = fullData.expenses.reduce((sum, i) => sum + i.amount, 0);
    fullData.totals = { grandTotal: totalM + diet.amount + totalE };
    fullData.dietSummary = { text: diet.text, amount: diet.amount };

    // Fjerner tunge bilder fra lagring for å unngå kvotesprekk
    const safeDataToSave = {
        ...fullData,
        receipts: [],
        signatureContent: null
    };

    // 1. Lagre alltid en kopi lokalt!
    saveLocalTrip(tripName, safeDataToSave);

    // 2. Hvis logget inn med Supabase, synkroniser til skyen
    if (currentUser && supabaseClient) {
        try {
            const payload = {
                user_id: currentUser.id,
                trip_name: tripName,
                report_data: safeDataToSave,
                status: 'lagret'
            };

            const { error } = await supabaseClient.from('expense_reports').insert([payload]);
            if (error) throw error;
            showToast(`Reiseregningen "${tripName}" er lagret i skyen og lokalt!`, "success");
        } catch (e) {
            console.warn("Sky-lagring feilet, men lokal kopi er trygg:", e);
            showToast(`Lagret lokalt på maskinen din! (Skylagring: ${e.message})`, "info");
        }
    } else {
        showToast(`Reisen er lagret lokalt på denne enheten!`, "success");
    }

    if (btnSave) setLoadingState(btnSave, false);
}

async function submitExpenseReport() {
    // Bedriftsportal er deaktivert; lagrer som vanlig reise
    await saveExpenseReport('lagret');
}

// Dialog for å vise lagrede reiser
async function showSavedReports() {
    const modal = document.createElement('div');
    modal.id = 'saved-reports-modal';
    modal.className = 'modal-overlay';
    
    const localTrips = getLocalSavedTrips();
    let cloudTrips = [];
    let cloudError = null;

    if (currentUser && supabaseClient) {
        try {
            const { data, error } = await supabaseClient
                .from('expense_reports')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
            if (error) cloudError = error.message;
            else cloudTrips = data || [];
        } catch (e) {
            cloudError = e.message;
        }
    }

    const renderTripsTable = (trips, isCloud = false) => {
        if (!trips || trips.length === 0) {
            return `<div class="empty-state">Ingen lagrede reiser funnet her ennå.</div>`;
        }
        return `
            <div class="table-responsive">
                <table>
                    <thead>
                        <tr>
                            <th>Dato</th>
                            <th>Reisenavn</th>
                            <th>Status</th>
                            <th style="text-align: right;">Beløp</th>
                            <th style="text-align: right;">Handling</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${trips.map(t => {
                            const dateStr = new Date(t.created_at).toLocaleDateString('no-NO');
                            const sum = t.report_data?.totals?.grandTotal || 0;
                            const statusBadge = t.status === 'innsendt' ? '<span class="status-badge badge-submitted">Innsendt</span>' :
                                               t.status === 'godkjent' ? '<span class="status-badge badge-approved">Godkjent</span>' :
                                               t.status === 'utbetalt' ? '<span class="status-badge badge-paid">Utbetalt</span>' :
                                               '<span class="status-badge badge-draft">Kladd</span>';
                            
                            const encodedTrip = encodeURIComponent(JSON.stringify(t));
                            return `
                                <tr>
                                    <td style="font-size: 0.85rem;">${dateStr}</td>
                                    <td><strong>${escapeHTML(t.trip_name || 'Uten navn')}</strong></td>
                                    <td>${statusBadge}</td>
                                    <td style="text-align: right; font-weight: 600; font-family: 'JetBrains Mono', monospace;">${currencyFormatter.format(sum)}</td>
                                    <td style="text-align: right;">
                                        <button type="button" class="btn btn-primary btn-small" onclick="loadTripFromSaved('${encodedTrip}')">Last inn</button>
                                        <button type="button" class="btn btn-outline btn-small" onclick="deleteSavedTrip('${t.id}', ${isCloud})">Slett</button>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    };

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 800px;">
            <div class="modal-header">
                <h2>Lagrede Reiseregninger</h2>
                <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <div style="display: flex; gap: 8px; margin-bottom: 18px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">
                    <button type="button" id="tab-saved-cloud" class="btn btn-primary btn-small" onclick="switchSavedTab('cloud')">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                        Sky-synkroniserte (${currentUser ? cloudTrips.length : 'Logg inn'})
                    </button>
                    <button type="button" id="tab-saved-local" class="btn btn-outline btn-small" onclick="switchSavedTab('local')">
                        Lokale kladder (${localTrips.length})
                    </button>
                </div>

                <div id="saved-tab-content-cloud" style="display: block;">
                    ${!currentUser ? `
                        <div class="empty-state" style="padding: 26px 18px; text-align: center;">
                            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin: 0 auto 10px auto; color: var(--accent-color); display: block;"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
                            <h3 style="margin-bottom: 6px; font-size: 1.05rem;">Sky-synkroniserte reiser</h3>
                            <p style="color: var(--text-muted); font-size: 0.88rem; max-width: 440px; margin: 0 auto 16px auto;">
                                Sky-synkronisering lagrer reiseregningene dine trygt og gjør dem tilgjengelige fra alle dine enheter. Logg inn eller opprett konto for å se reisene dine.
                            </p>
                            <div style="display: flex; gap: 10px; justify-content: center; flex-wrap: wrap;">
                                <button type="button" class="btn btn-primary btn-small" onclick="closeModal(); toggleAuthPanel();">Logg inn / Registrer</button>
                                <button type="button" class="btn btn-outline btn-small" onclick="switchSavedTab('local')">Se lokale kladder (${localTrips.length})</button>
                            </div>
                        </div>
                    ` : renderTripsTable(cloudTrips, true)}
                </div>

                <div id="saved-tab-content-local" style="display: none;">
                    <p style="font-size: 0.88rem; color: var(--text-muted); margin-bottom: 14px;">
                        Disse reisene er lagret direkte i nettleseren på denne maskinen og er tilgjengelige uten internett.
                    </p>
                    ${renderTripsTable(localTrips, false)}
                    
                    <div style="margin-top: 18px; display: flex; gap: 10px; justify-content: flex-end;">
                        <button type="button" class="btn btn-outline btn-small" onclick="exportBackupJSON()">
                            Eksporter JSON-sikkerhetskopi
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.classList.add('modal-open');
    document.body.appendChild(modal);
}

function switchSavedTab(tab) {
    const localContent = document.getElementById('saved-tab-content-local');
    const cloudContent = document.getElementById('saved-tab-content-cloud');
    const tabLocal = document.getElementById('tab-saved-local');
    const tabCloud = document.getElementById('tab-saved-cloud');

    if (tab === 'cloud') {
        if (localContent) localContent.style.display = 'none';
        if (cloudContent) cloudContent.style.display = 'block';
        if (tabCloud) { tabCloud.className = 'btn btn-primary btn-small'; }
        if (tabLocal) { tabLocal.className = 'btn btn-outline btn-small'; }
    } else {
        if (localContent) localContent.style.display = 'block';
        if (cloudContent) cloudContent.style.display = 'none';
        if (tabLocal) { tabLocal.className = 'btn btn-primary btn-small'; }
        if (tabCloud) { tabCloud.className = 'btn btn-outline btn-small'; }
    }
}

function loadTripFromSaved(encodedTrip) {
    try {
        const tripStr = decodeURIComponent(encodedTrip);
        loadTrip(tripStr);
        showToast("Reisen er lastet inn i skjemaet!", "success");
    } catch (e) {
        showToast("Klarte ikke laste reisen: " + e.message, "error");
    }
}

async function deleteSavedTrip(id, isCloud) {
    const ok = await showConfirm("Er du sikker på at du vil slette denne lagrede reisen?");
    if (!ok) return;

    if (!isCloud) {
        deleteLocalTrip(id);
        showToast("Reisen ble slettet lokalt.", "info");
        closeModal();
        showSavedReports();
    } else if (supabaseClient) {
        try {
            const { error } = await supabaseClient.from('expense_reports').delete().eq('id', id);
            if (error) throw error;
            showToast("Reisen ble slettet fra skyen.", "info");
            closeModal();
            showSavedReports();
        } catch (e) {
            showToast("Kunne ikke slette fra skyen: " + e.message, "error");
        }
    }
}

function exportBackupJSON() {
    const trips = getLocalSavedTrips();
    const blob = new Blob([JSON.stringify(trips, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reiseregning_Sikkerhetskopi_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast("Sikkerhetskopi lastet ned som JSON!", "success");
}

function resetFormState() {
    document.getElementById('mileage-body').innerHTML = '';
    document.getElementById('expenses-body').innerHTML = '';
    clearCanvas();
    uploadedReceipts = [];
    const container = document.getElementById('receipt-preview-container');
    if (container) container.innerHTML = '';
}

function loadTrip(tripRecordStr) {
    try {
        const record = typeof tripRecordStr === 'string' ? JSON.parse(tripRecordStr) : tripRecordStr;
        const trip = record.report_data || record;
        if (!trip) return;

        resetFormState();

        const safeSetVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        };

        if (trip.personalInfo) {
            safeSetVal('emp-company', trip.personalInfo.company);
            safeSetVal('emp-name', trip.personalInfo.name);
            safeSetVal('emp-id', trip.personalInfo.id);
            safeSetVal('emp-dept', trip.personalInfo.department);
            safeSetVal('emp-addr', trip.personalInfo.address);
            safeSetVal('emp-account', trip.personalInfo.account);
        }

        if (trip.travelInfo) {
            safeSetVal('travel-purpose', trip.travelInfo.purpose);
            safeSetVal('travel-event', trip.travelInfo.event);
            safeSetVal('accommodation-name', trip.travelInfo.accommodationName);
            safeSetVal('diet-mode', trip.travelInfo.dietMode || 'state');
            safeSetVal('accommodation-type', trip.travelInfo.accommodation || 'hotel');

            const depDate = document.getElementById('departure-date');
            if (depDate && depDate._flatpickr && trip.travelInfo.departure) {
                depDate._flatpickr.setDate(trip.travelInfo.departure);
            }
            const retDate = document.getElementById('return-date');
            if (retDate && retDate._flatpickr && trip.travelInfo.return) {
                retDate._flatpickr.setDate(trip.travelInfo.return);
            }
        }
        
        if (trip.mileage && Array.isArray(trip.mileage) && trip.mileage.length > 0) {
            trip.mileage.forEach(item => {
                addMileageRow({
                    from: item.from,
                    to: item.to,
                    km: item.km,
                    pass: item.passenger,
                    toll: item.toll,
                    date: item.date
                });
            });
        } else {
            addMileageRow();
        }

        if (trip.expenses && Array.isArray(trip.expenses) && trip.expenses.length > 0) {
            trip.expenses.forEach(item => {
                addExpenseRow({
                    date: item.date,
                    description: item.description,
                    amount: item.amount,
                    receipt: item.receipt
                });
            });
        } else {
            addExpenseRow();
        }

        if (trip.finalDatePlace) {
            safeSetVal('final-date-place', trip.finalDatePlace);
        }
        
        calculateAll();
        closeModal();
    } catch (e) {
        console.error("Klarte ikke laste inn reisen", e);
    }
}

// --- 8. EKSEMPELREISE & VEILEDNINGSGJENNOMGANG ---
function clearForm() {
    if (!confirm("Vil du nullstille hele skjemaet og starte med et tomt dokument?")) return;
    resetFormState();
    
    const safeSetVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val;
    };

    safeSetVal('travel-purpose', '');
    safeSetVal('travel-event', '');
    safeSetVal('accommodation-name', '');
    safeSetVal('accommodation-type', 'hotel');
    safeSetVal('diet-mode', 'state');

    const depDate = document.getElementById('departure-date');
    if (depDate && depDate._flatpickr) depDate._flatpickr.clear();
    const retDate = document.getElementById('return-date');
    if (retDate && retDate._flatpickr) retDate._flatpickr.clear();

    document.querySelectorAll('.meal-check').forEach(cb => { cb.checked = false; });

    addMileageRow();
    addExpenseRow();
    calculateAll();
    closeWalkthroughBanner();
    showToast("Skjemaet er tømt.", "info");
}

function drawSampleSignature() {
    const canvas = document.getElementById('sig-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    clearCanvas();
    
    ctx.strokeStyle = '#1e3a8a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    ctx.beginPath();
    ctx.moveTo(40, 70);
    ctx.bezierCurveTo(60, 20, 80, 20, 95, 75);
    ctx.bezierCurveTo(110, 110, 130, 110, 150, 60);
    ctx.bezierCurveTo(170, 30, 185, 80, 210, 65);
    ctx.bezierCurveTo(240, 50, 270, 75, 310, 60);
    ctx.moveTo(35, 95);
    ctx.lineTo(290, 85);
    ctx.stroke();
    
    canvasHasContent = true;
}

function loadExampleTrip() {
    resetFormState();

    const safeSetVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.value = val || '';
    };

    // 1. Personopplysninger
    safeSetVal('emp-name', "Ola Nordmann");
    safeSetVal('emp-addr', "Storgata 10, 0182 Oslo");
    safeSetVal('emp-company', "Nordic Solutions AS");
    safeSetVal('emp-id', "1042");
    safeSetVal('emp-dept', "Rådgivning & Prosjekt");
    safeSetVal('emp-account', "1234.56.78901");

    // 2. Reiseinformasjon & Diett
    safeSetVal('travel-purpose', "Kundemøte og systemimplementasjon");
    safeSetVal('travel-event', "Kvartalsvis statusmøte Bergen");
    safeSetVal('accommodation-type', "hotel");
    safeSetVal('accommodation-name', "Radisson Blu Hotel Norge, Nedre Ole Bulls plass 4, Bergen");
    safeSetVal('diet-mode', "state");

    const dep = document.getElementById('departure-date');
    if (dep && dep._flatpickr) dep._flatpickr.setDate("2026-10-01 07:30");
    const ret = document.getElementById('return-date');
    if (ret && ret._flatpickr) ret._flatpickr.setDate("2026-10-03 16:30");

    // Frokost dekket av hotell (-20% måltidstrekk)
    document.querySelectorAll('.meal-check').forEach((cb, idx) => {
        cb.checked = (idx === 0);
    });

    // 3. Kjøregodtgjørelse (Bil)
    addMileageRow({ from: "Oslo", to: "Bergen", km: "465", pass: "Kari Konsulent", toll: "280", date: "2026-10-01 07:30" });
    addMileageRow({ from: "Bergen", to: "Oslo", km: "465", pass: "", toll: "280", date: "2026-10-03 11:30" });

    // 4. Andre utlegg
    addExpenseRow({ date: "2026-10-02", description: "Parkering ByGarasjen Bergen (2 døgn)", amount: "580", receipt: true });
    addExpenseRow({ date: "2026-10-02", description: "Drosje til kveldsarrangement", amount: "240", receipt: true });

    // 6. Signatur og bekreftelse
    safeSetVal('final-date-place', "Oslo, 03.10.2026");
    drawSampleSignature();

    calculateAll();
    showWalkthroughBanner();
    showToast("Eksempelreise lastet inn med full gjennomgang!", "success");
}

function showWalkthroughBanner() {
    const container = document.getElementById('example-walkthrough-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="walkthrough-banner">
            <div class="walkthrough-header">
                <div>
                    <div class="walkthrough-title">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-color);"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                        <span>Eksempelreise &ndash; Slik fungerer reiseregningen</span>
                    </div>
                    <p style="margin: 3px 0 0 0; font-size: 0.86rem; color: var(--text-muted);">
                        Skjemaet er nå ferdig utfylt som en illustrasjon. Her ser du hvordan de ulike delene fungerer sammen:
                    </p>
                </div>
                <button type="button" class="btn-text btn-small" onclick="closeWalkthroughBanner()" title="Lukk veiledning" style="font-size: 1.2rem; line-height: 1; padding: 2px 6px;">&times;</button>
            </div>

            <div class="walkthrough-grid">
                <div class="walkthrough-step">
                    <strong>1. Person- og firmainfo</strong>
                    Fyll ut navn, adresse og firma. Bruk «Husk mine data» i kontomenyen for automatisk gjenbruk ved fremtidige reiser.
                </div>
                <div class="walkthrough-step">
                    <strong>2. Automatisk diett 2026</strong>
                    Avreise og hjemkomst kalkulerer automatisk 2 døgn + 9t overskytende etter Statens satser. Frokostkrysset trekker 20%.
                </div>
                <div class="walkthrough-step">
                    <strong>3. Kjøregodtgjørelse</strong>
                    5,30 kr/km + 1,00 kr/km for passasjer + bompenger regnes ut per etappe. «+ Legg til returreise» snur automatisk ruten.
                </div>
                <div class="walkthrough-step">
                    <strong>4. Utlegg & kvitteringer</strong>
                    Før opp parkering, taxi eller billetter. Opplastede kvitteringsbilder legges automatisk til som vedleggssider i PDF-en.
                </div>
                <div class="walkthrough-step">
                    <strong>5. PDF & CSV eksport</strong>
                    Signer direkte i signaturfeltet. Trykk «Forhåndsvis PDF» for utskriftsklar offentlig blankett, eller last ned som CSV-regneark.
                </div>
            </div>

            <div class="walkthrough-actions">
                <button type="button" class="btn btn-primary btn-small" onclick="previewExpenseReport()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                    Forhåndsvis PDF-blankett nå
                </button>
                <button type="button" class="btn-clear-blue" onclick="clearForm()">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    Tøm skjema (start på nytt)
                </button>
                <button type="button" class="btn btn-ghost btn-small" onclick="closeWalkthroughBanner()">
                    Lukk denne veiledningen
                </button>
            </div>
        </div>
    `;
    container.style.display = 'block';
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeWalkthroughBanner() {
    const container = document.getElementById('example-walkthrough-container');
    if (container) container.style.display = 'none';
}

function loadTemplate(type) {
    if (type === 'clear') {
        clearForm();
    } else {
        loadExampleTrip();
    }
}

// --- 9. MODAL: STATENS SATSER 2026 ---
function showRatesModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 720px;">
            <div class="modal-header">
                <h2>Statens Satser for 2026</h2>
                <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body">
                <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 20px;">
                    Gjeldende satser for innenlandsreiser fra 1. januar 2026, iht. Statens reiseregulativ og Skatteetatens trekkfrie satser.
                </p>

                <h3 style="margin-bottom: 8px;">1. Kjøregodtgjørelse (Kilometersats)</h3>
                <div class="table-responsive" style="margin-bottom: 20px;">
                    <table>
                        <thead>
                            <tr>
                                <th>Type godtgjørelse</th>
                                <th>Statens sats 2026</th>
                                <th>Trekkfri sats</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Kilometersats bil (uansett drivstoff)</td>
                                <td><strong>5,30 kr/km</strong></td>
                                <td>3,50 kr/km</td>
                            </tr>
                            <tr>
                                <td>Passasjertillegg (per passasjer)</td>
                                <td><strong>1,00 kr/km</strong></td>
                                <td>1,00 kr/km</td>
                            </tr>
                            <tr>
                                <td>Tilhengertillegg</td>
                                <td><strong>1,00 kr/km</strong></td>
                                <td>1,00 kr/km</td>
                            </tr>
                            <tr>
                                <td>Bompenger og fergeutgifter</td>
                                <td colspan="2">Refunderes etter faktiske utgifter</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <h3 style="margin-bottom: 8px;">2. Diettgodtgjørelse (Døgn & Dagsdiett)</h3>
                <div class="table-responsive" style="margin-bottom: 20px;">
                    <table>
                        <thead>
                            <tr>
                                <th>Reisetype / Overnatting</th>
                                <th>Statens sats 2026</th>
                                <th>Trekkfri sats</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>Døgn med hotellovernatting</td>
                                <td><strong>1 012 kr</strong></td>
                                <td>693 kr</td>
                            </tr>
                            <tr>
                                <td>Døgn m/kokemulighet (hybel/brakke)</td>
                                <td><strong>400 kr</strong></td>
                                <td>400 kr</td>
                            </tr>
                            <tr>
                                <td>Døgn uten kokemulighet (privat)</td>
                                <td><strong>107 kr</strong></td>
                                <td>107 kr</td>
                            </tr>
                            <tr>
                                <td>Dagsdiett 6 &ndash; 12 timer</td>
                                <td><strong>397 kr</strong></td>
                                <td>200 kr</td>
                            </tr>
                            <tr>
                                <td>Dagsdiett over 12 timer</td>
                                <td><strong>736 kr</strong></td>
                                <td>400 kr</td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <h3 style="margin-bottom: 8px;">3. Måltidsfradrag ved dekket måltid</h3>
                <p style="font-size: 0.88rem; color: var(--text-secondary); margin-bottom: 10px;">
                    Dersom måltider dekkes av arrangør eller arbeidsgiver, gjøres det prosentvis trekk i døgndiett:
                </p>
                <div style="display: flex; gap: 15px; margin-bottom: 25px; flex-wrap: wrap;">
                    <div style="background: #f1f5f9; padding: 10px 16px; border-radius: 8px; flex: 1;">
                        <span style="display:block; font-size: 0.75rem; color: #64748b; font-weight:700;">FROKOST</span>
                        <strong style="font-size: 1.1rem; color: #0f172a;">-20%</strong>
                    </div>
                    <div style="background: #f1f5f9; padding: 10px 16px; border-radius: 8px; flex: 1;">
                        <span style="display:block; font-size: 0.75rem; color: #64748b; font-weight:700;">LUNSJ</span>
                        <strong style="font-size: 1.1rem; color: #0f172a;">-30%</strong>
                    </div>
                    <div style="background: #f1f5f9; padding: 10px 16px; border-radius: 8px; flex: 1;">
                        <span style="display:block; font-size: 0.75rem; color: #64748b; font-weight:700;">MIDDAG</span>
                        <strong style="font-size: 1.1rem; color: #0f172a;">-50%</strong>
                    </div>
                </div>

                <div style="text-align: right;">
                    <button type="button" class="btn btn-primary" onclick="closeModal()">Lukk oversikt</button>
                </div>
            </div>
        </div>
    `;

    document.body.classList.add('modal-open');
    document.body.appendChild(modal);
}

// --- 10. BRUKERVEILEDNING ---
function showHelpModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 680px;">
            <div class="modal-header">
                <h2>Hvordan fylle ut reiseregning</h2>
                <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
            </div>
            <div class="modal-body" style="line-height: 1.6;">
                <h3 style="margin-bottom: 6px;">Enkelt, raskt og nøyaktig</h3>
                <p>Denne appen beregner kjøregodtgjørelse, diett og utlegg iht. gjeldende norske satser for 2026.</p>

                <div style="display: flex; flex-direction: column; gap: 14px; margin: 20px 0;">
                    <div style="display: flex; gap: 12px;">
                        <span style="background: var(--accent-subtle); color: var(--accent-color); font-weight: bold; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">1</span>
                        <div>
                            <strong>Person- og reiseopplysninger:</strong> Skriv inn navn og reiseformål. Fyll inn avreisedato og hjemkomstdato for å starte den automatiske diettberegningen.
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <span style="background: var(--accent-subtle); color: var(--accent-color); font-weight: bold; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">2</span>
                        <div>
                            <strong>Kjøring og bompenger:</strong> Legg til kjørte strekninger. Trykk <em>"+ Legg til returreise"</em> for automatisk å snu ruten.
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <span style="background: var(--accent-subtle); color: var(--accent-color); font-weight: bold; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">3</span>
                        <div>
                            <strong>Utlegg og kvitteringer:</strong> Før opp drosje, parkering eller togbilletter. Last opp bilder av kvitteringer; de legges automatisk ved PDF-dokumentet.
                        </div>
                    </div>
                    <div style="display: flex; gap: 12px;">
                        <span style="background: var(--accent-subtle); color: var(--accent-color); font-weight: bold; width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">4</span>
                        <div>
                            <strong>Forhåndsvisning og eksport:</strong> Trykk <em>"Forhåndsvis PDF"</em> for å skrive ut eller lagre som PDF via nettleseren. Du kan også laste ned CSV for regnskap.
                        </div>
                    </div>
                </div>

                <div style="text-align: right; margin-top: 24px;">
                    <button type="button" class="btn btn-primary" onclick="closeModal()">Forstått, gå til skjema</button>
                </div>
            </div>
        </div>
    `;

    document.body.classList.add('modal-open');
    document.body.appendChild(modal);
}

// --- 11. CSV EXPORT ---
function exportToCSV() {
    const data = collectFormData();
    if (!data.personalInfo.name || !data.travelInfo.purpose) {
        showToast("Vennligst fyll ut navn og formål før eksport.", "error");
        return;
    }

    const diet = calculateDiet();
    let csvContent = "";

    const formatNum = (num) => Number(num).toFixed(2).replace('.', ',');
    const cleanStr = (str) => str ? String(str).replace(/[\r\n;]/g, ' ').trim() : '';

    // Metadata
    csvContent += `Navn;${cleanStr(data.personalInfo.name)}\n`;
    csvContent += `Firma;${cleanStr(data.personalInfo.company)}\n`;
    csvContent += `Ansattnr;${cleanStr(data.personalInfo.id)}\n`;
    csvContent += `Avdeling;${cleanStr(data.personalInfo.department)}\n`;
    if (data.personalInfo.account) csvContent += `Kontonummer;${cleanStr(data.personalInfo.account)}\n`;
    csvContent += `Formål;${cleanStr(data.travelInfo.purpose)}\n`;
    csvContent += `Periode;${cleanStr(data.travelInfo.departure)} til ${cleanStr(data.travelInfo.return)}\n`;
    csvContent += `\n`;

    // Kolonner
    csvContent += `Dato;Beskrivelse/Rute;Type;Antall/Km;Sats;Beløp (NOK)\n`;

    let totalSum = 0;

    // Mileage
    data.mileage.forEach(i => {
        if (i.km > 0 || i.toll > 0) {
            let kmRate = i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km;
            let kmAmount = i.km * kmRate;
            let desc = `${i.from} - ${i.to}`;
            if (i.passenger.length > 0) desc += ` (Passasjer: ${i.passenger})`;
            csvContent += `${cleanStr(i.date)};${cleanStr(desc)};Kjøring;${formatNum(i.km)};${formatNum(kmRate)};${formatNum(kmAmount)}\n`;
            totalSum += kmAmount;

            if (i.toll > 0) {
                csvContent += `${cleanStr(i.date)};Bompenger ${cleanStr(desc)};Bompenger;1;${formatNum(i.toll)};${formatNum(i.toll)}\n`;
                totalSum += i.toll;
            }
        }
    });

    // Diet
    if (diet.amount > 0 || data.travelInfo.departure) {
        csvContent += `${cleanStr(data.travelInfo.departure)};${cleanStr(diet.text)};Diett;1;${formatNum(diet.amount)};${formatNum(diet.amount)}\n`;
        totalSum += diet.amount;
    }

    // Expenses
    data.expenses.forEach(i => {
        if (i.amount > 0 || i.description) {
            csvContent += `${cleanStr(i.date)};${cleanStr(i.description)};Utlegg;1;${formatNum(i.amount)};${formatNum(i.amount)}\n`;
            totalSum += i.amount;
        }
    });

    csvContent += `\n`;
    csvContent += `TOTALT TIL UTBETALING;;;;;${formatNum(totalSum)}\n`;

    // UTF-8 BOM for direkte åpning i Excel
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    const today = new Date().toISOString().split('T')[0];
    const filename = `Reiseregning_${data.personalInfo.name.replace(/\s+/g, '_')}_${today}.csv`;

    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    showToast("CSV-fil lastet ned!", "success");
}

// --- 12. SEND TIL REGNSKAPSFØRER ---
function generateAccountantEmailText(comment = '') {
    const data = collectFormData();
    const diet = calculateDiet();
    let totalM = data.mileage.reduce((sum, i) => sum + (i.km * (i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km)) + i.toll, 0);
    let totalE = data.expenses.reduce((sum, i) => sum + i.amount, 0);
    let grandTotal = totalM + diet.amount + totalE;

    let text = `Hei,\n\nHer oversendes reiseregning for ${data.personalInfo.name || 'ansatt'}.\n\n`;

    if (comment && comment.trim()) {
        text += `MERKNAD FRA DEN REISENDE:\n${comment.trim()}\n\n`;
    }

    text += `1. REISE- OG PERSONOPPLYSNINGER\n`;
    text += `--------------------------------------------------\n`;
    text += `Navn: ${data.personalInfo.name}\n`;
    if (data.personalInfo.company) text += `Firma / Arbeidsgiver: ${data.personalInfo.company}\n`;
    if (data.personalInfo.id) text += `Ansattnummer / Ref: ${data.personalInfo.id}\n`;
    if (data.personalInfo.department) text += `Avdeling / Prosjekt: ${data.personalInfo.department}\n`;
    if (data.personalInfo.address) text += `Adresse: ${data.personalInfo.address}\n`;
    if (data.personalInfo.account) text += `Kontonummer for utbetaling: ${data.personalInfo.account}\n`;
    text += `Formål med reisen: ${data.travelInfo.purpose}\n`;
    if (data.travelInfo.event) text += `Arrangement / Møte: ${data.travelInfo.event}\n`;
    text += `Periode: ${data.travelInfo.departure || '-'} til ${data.travelInfo.return || '-'}\n`;
    if (data.travelInfo.accommodationName) text += `Overnatting: ${data.travelInfo.accommodationName}\n`;
    text += `\n`;

    text += `2. SPESIFIKASJON OG BEREGNING (Statens satser 2026)\n`;
    text += `--------------------------------------------------\n`;

    // Diett
    text += `DIETTGODTGJØRELSE: ${currencyFormatter.format(diet.amount)}\n`;
    text += `Spesifikasjon: ${diet.text}\n\n`;

    // Kjøring
    text += `KJØREGODTGJØRELSE: ${currencyFormatter.format(totalM)}\n`;
    if (data.mileage && data.mileage.some(m => m.km > 0 || m.toll > 0)) {
        data.mileage.forEach((m, idx) => {
            if (m.km > 0 || m.toll > 0) {
                const legRate = m.passenger.length > 0 ? (RATES.km + RATES.passenger) : RATES.km;
                const legSum = (m.km * legRate) + m.toll;
                text += `  • Etappe ${idx + 1}: ${m.date || ''} ${m.from} -> ${m.to} (${m.km} km @ ${legRate.toFixed(2)} kr/km`;
                if (m.passenger) text += `, passasjer: ${m.passenger}`;
                if (m.toll > 0) text += `, bom: ${m.toll} kr`;
                text += `) = ${currencyFormatter.format(legSum)}\n`;
            }
        });
    } else {
        text += `  Ingen kjøring ført.\n`;
    }
    text += `\n`;

    // Andre utlegg
    text += `ANDRE UTLEGG: ${currencyFormatter.format(totalE)}\n`;
    if (data.expenses && data.expenses.some(e => e.amount > 0 || e.description)) {
        data.expenses.forEach(e => {
            if (e.amount > 0 || e.description) {
                text += `  • ${e.date || ''} ${e.description}: ${currencyFormatter.format(e.amount)} (${e.receipt ? 'Kvittering vedlagt' : 'Uten kvittering'})\n`;
            }
        });
    } else {
        text += `  Ingen andre utlegg.\n`;
    }
    text += `\n`;

    text += `--------------------------------------------------\n`;
    text += `TOTALT TIL UTBETALING: ${currencyFormatter.format(grandTotal)}\n`;
    text += `--------------------------------------------------\n`;
    if (data.personalInfo.account) {
        text += `Utbetales til bankkonto: ${data.personalInfo.account}\n\n`;
    }

    text += `Vedlegg: ${data.receipts.length} kvitteringsbilde(r) er lagt ved.\n`;
    text += `Generert via Reiseregning 2026 (Statens satser).\n`;

    return text;
}

function openSendToAccountantModal() {
    const data = collectFormData();
    if (!data.personalInfo.name || !data.travelInfo.purpose) {
        showToast("Vennligst fyll ut minst navn og reiseformål før du sender til regnskapsfører.", "error");
        return;
    }

    const diet = calculateDiet();
    let totalM = data.mileage.reduce((sum, i) => sum + (i.km * (i.passenger.length > 0 ? RATES.km + RATES.passenger : RATES.km)) + i.toll, 0);
    let totalE = data.expenses.reduce((sum, i) => sum + i.amount, 0);
    let grandTotal = totalM + diet.amount + totalE;

    const savedEmail = localStorage.getItem('reiseregning_accountant_email') || '';
    const defaultSubject = `Reiseregning 2026 - ${data.personalInfo.name} - ${data.travelInfo.purpose} (${currencyFormatter.format(grandTotal)})`;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'send-accountant-modal';

    modal.innerHTML = `
        <div class="modal-content" style="max-width: 760px;">
            <div class="modal-header">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <div style="background: var(--success-subtle); color: var(--success-color); width: 34px; height: 34px; border-radius: 50%; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                    </div>
                    <div>
                        <h2 style="font-size: 1.15rem; margin: 0;">Send reiseregning til regnskapsfører</h2>
                        <span style="font-size: 0.82rem; color: var(--text-muted);">Spesifikasjon og utbetalingsgrunnlag klar til oversendelse</span>
                    </div>
                </div>
                <button type="button" class="modal-close" onclick="closeModal()">&times;</button>
            </div>

            <div class="modal-body" style="padding: 20px 24px;">
                <div class="grid-row" style="margin-bottom: 10px;">
                    <div class="form-group" style="flex: 1.4;">
                        <label for="acc-email">Regnskapsførerens / Lønnsavdelingens e-post *</label>
                        <input type="email" id="acc-email" value="${escapeHTML(savedEmail)}" placeholder="f.eks. regnskap@bedrift.no eller ole@regnskapskontor.no" required autofocus>
                    </div>
                    <div class="form-group" style="flex: 1;">
                        <label for="acc-cc">Kopi (valgfri e-post)</label>
                        <input type="email" id="acc-cc" value="${currentUser ? escapeHTML(currentUser.email) : ''}" placeholder="Din egen e-post">
                    </div>
                </div>

                <div style="margin-bottom: 12px;">
                    <label style="display: inline-flex; align-items: center; gap: 7px; font-weight: 500; cursor: pointer; font-size: 0.83rem; color: var(--text-secondary); text-transform: none;">
                        <input type="checkbox" id="acc-remember-email" ${savedEmail ? 'checked' : ''} style="width: 15px; height: 15px; accent-color: var(--accent-color);">
                        Husk regnskapsførerens e-postadresse på denne enheten
                    </label>
                </div>

                <div class="form-group" style="margin-bottom: 12px;">
                    <label for="acc-subject">E-post emne</label>
                    <input type="text" id="acc-subject" value="${escapeHTML(defaultSubject)}">
                </div>

                <div class="form-group" style="margin-bottom: 14px;">
                    <label for="acc-comment">Melding / Merknad til regnskapsfører (valgfritt)</label>
                    <textarea id="acc-comment" rows="2" placeholder="F.eks.: Hei! Her er reiseregning for forrige ukes kundereise. Kvitteringer og spesifikasjon er vedlagt."></textarea>
                </div>

                <!-- Sammendragskort -->
                <div style="background: #f8fafc; border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="font-size: 0.82rem; color: var(--text-primary); text-transform: uppercase; letter-spacing: 0.03em;">Oppsummering som oversendes:</strong>
                        <span style="font-family: 'JetBrains Mono', monospace; font-weight: 700; color: var(--success-color); font-size: 1.15rem;">${currencyFormatter.format(grandTotal)}</span>
                    </div>
                    <div style="font-size: 0.84rem; color: var(--text-secondary); line-height: 1.5;">
                        <div><strong>Reisende:</strong> ${escapeHTML(data.personalInfo.name)} ${data.personalInfo.company ? `(${escapeHTML(data.personalInfo.company)})` : ''}</div>
                        ${data.personalInfo.account ? `<div><strong>Kontonr for utbetaling:</strong> ${escapeHTML(data.personalInfo.account)}</div>` : ''}
                        <div><strong>Periode & Formål:</strong> ${escapeHTML(data.travelInfo.departure || '-')} til ${escapeHTML(data.travelInfo.return || '-')} &ndash; ${escapeHTML(data.travelInfo.purpose)}</div>
                        <div style="margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--border-color); display: flex; gap: 14px; flex-wrap: wrap;">
                            <span>Kjøring: <strong>${currencyFormatter.format(totalM)}</strong></span>
                            <span>Diett: <strong>${currencyFormatter.format(diet.amount)}</strong></span>
                            <span>Utlegg: <strong>${currencyFormatter.format(totalE)}</strong></span>
                            <span>Vedlegg: <strong>${data.receipts.length} stk</strong></span>
                        </div>
                    </div>
                </div>

                <!-- Sende-kanaler -->
                <div style="margin-bottom: 6px;">
                    <label style="font-weight: 700; font-size: 0.84rem; color: var(--text-primary); margin-bottom: 8px; display: block;">
                        Velg hvordan du vil sende eller overføre:
                    </label>
                    <div class="email-channel-grid">
                        <!-- Gmail -->
                        <button type="button" class="btn-email-channel gmail" onclick="dispatchAccountantEmail('gmail')" title="Åpner direkte i Gmail i nettleseren (anbefalt for Chrome)">
                            <div class="channel-header">
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
                                <span>Åpne i Gmail</span>
                            </div>
                            <span class="channel-sub">Direkte i nettleseren</span>
                        </button>

                        <!-- Outlook på nett -->
                        <button type="button" class="btn-email-channel outlook" onclick="dispatchAccountantEmail('outlook')" title="Åpner direkte i Outlook på nett / Microsoft 365">
                            <div class="channel-header">
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"></rect><line x1="3" y1="10" x2="21" y2="10"></line><line x1="9" y1="4" x2="9" y2="20"></line></svg>
                                <span>Åpne i Outlook</span>
                            </div>
                            <span class="channel-sub">Nett / Microsoft 365</span>
                        </button>

                        <!-- Lokalt e-postprogram -->
                        <button type="button" class="btn-email-channel client" onclick="dispatchAccountantEmail('client')" title="Åpner installert e-postprogram som Outlook på PC/Mac eller Apple Mail">
                            <div class="channel-header">
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                                <span>E-postprogram</span>
                            </div>
                            <span class="channel-sub">Outlook / Apple Mail</span>
                        </button>

                        <!-- Kopier tekst direkte -->
                        <button type="button" class="btn-email-channel copy-direct" onclick="copyAccountantSummary()" title="Kopier hele den ferdige spesifikasjonen med ett klikk">
                            <div class="channel-header">
                                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                <span>Kopier e-posttekst</span>
                            </div>
                            <span class="channel-sub">Lim inn i e-post/chat</span>
                        </button>
                    </div>
                </div>

                <!-- Info om tomt Chrome-vindu -->
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: var(--radius-sm); padding: 8px 12px; margin-bottom: 14px; font-size: 0.8rem; color: #166534; display: flex; align-items: flex-start; gap: 8px;">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <div>
                        <strong>Løsning for tomt Chrome-vindu:</strong> Hvis Chrome åpnet en tom fane tidligere, skyldes det at Chrome manglet kobling til et lokalt installert e-postprogram. Trykk <strong>«Åpne i Gmail»</strong> eller <strong>«Åpne i Outlook»</strong> for å åpne rett i nettleseren, eller bruk <strong>«Kopier e-posttekst»</strong>.
                    </div>
                </div>

                <!-- Forhåndsvisning og redigering av e-posttekst -->
                <div class="email-preview-box">
                    <div class="email-preview-header">
                        <span style="font-size: 0.8rem; font-weight: 700; color: var(--text-secondary);">
                            Forhåndsvisning av teksten som sendes:
                        </span>
                        <button type="button" class="btn btn-outline btn-small" onclick="copyAccountantSummary()" style="padding: 3px 10px; font-size: 0.78rem;">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px;"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                            Kopier tekst
                        </button>
                    </div>
                    <textarea id="acc-email-preview" class="email-preview-textarea" readonly></textarea>
                </div>

                <!-- Vedleggsknapper -->
                <div style="display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                    <button type="button" class="btn btn-outline btn-small" onclick="exportToCSV()" title="Last ned CSV-regneark som kan legges ved e-posten" style="flex: 1; justify-content: center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                        Last ned CSV for regnskap
                    </button>
                    <button type="button" class="btn btn-outline btn-small" onclick="closeModal(); previewExpenseReport();" title="Åpne PDF-blankett for utskrift eller lagring som PDF" style="flex: 1; justify-content: center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg>
                        Lagre som PDF for vedlegg
                    </button>
                    ${navigator.share ? `
                    <button type="button" class="btn btn-outline btn-small" onclick="shareWithAccountant()" title="Del direkte via telefonens/nettleserens delefunksjon" style="flex: 0.8; justify-content: center;">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                        Del via app
                    </button>` : ''}
                </div>
            </div>
        </div>
    `;

    document.body.classList.add('modal-open');
    document.body.appendChild(modal);

    // Initialiser forhåndsvisning og lytt til endringer i kommentar
    const commentEl = document.getElementById('acc-comment');
    const previewEl = document.getElementById('acc-email-preview');
    if (previewEl) {
        previewEl.value = generateAccountantEmailText('');
    }
    if (commentEl && previewEl) {
        commentEl.addEventListener('input', () => {
            previewEl.value = generateAccountantEmailText(commentEl.value);
        });
    }
}

function copyToClipboardSilent(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
}

function dispatchAccountantEmail(method = 'gmail') {
    const emailInput = document.getElementById('acc-email');
    const ccInput = document.getElementById('acc-cc');
    const subjectInput = document.getElementById('acc-subject');
    const commentInput = document.getElementById('acc-comment');
    const rememberCb = document.getElementById('acc-remember-email');

    const email = emailInput ? emailInput.value.trim() : '';
    if (!email || !email.includes('@')) {
        showToast("Vennligst oppgi en gyldig e-postadresse til regnskapsfører.", "error");
        if (emailInput) emailInput.focus();
        return;
    }

    if (rememberCb && rememberCb.checked) {
        localStorage.setItem('reiseregning_accountant_email', email);
    } else {
        localStorage.removeItem('reiseregning_accountant_email');
    }

    const cc = ccInput ? ccInput.value.trim() : '';
    const subject = subjectInput && subjectInput.value ? subjectInput.value.trim() : 'Reiseregning 2026';
    const comment = commentInput ? commentInput.value.trim() : '';
    const bodyText = generateAccountantEmailText(comment);

    // Kopier alltid hele teksten til utklippstavlen som pålitelig backup
    copyToClipboardSilent(bodyText);

    if (method === 'gmail') {
        let gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;
        if (cc) gmailUrl += `&cc=${encodeURIComponent(cc)}`;
        gmailUrl += `&su=${encodeURIComponent(subject)}`;
        gmailUrl += `&body=${encodeURIComponent(bodyText)}`;

        const win = window.open(gmailUrl, '_blank', 'noopener,noreferrer');
        if (!win || win.closed || typeof win.closed === 'undefined') {
            showToast("Gmail-vinduet ble blokkert av nettleserens popup-stopper. Teksten er kopiert til utklippstavlen!", "warning");
        } else {
            showToast("Gmail åpnet i ny fane med ferdig utfylt spesifikasjon! (Teksten er også kopiert)", "success");
        }
    } else if (method === 'outlook') {
        let outlookUrl = `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(email)}`;
        if (cc) outlookUrl += `&cc=${encodeURIComponent(cc)}`;
        outlookUrl += `&subject=${encodeURIComponent(subject)}`;
        outlookUrl += `&body=${encodeURIComponent(bodyText)}`;

        const win = window.open(outlookUrl, '_blank', 'noopener,noreferrer');
        if (!win || win.closed || typeof win.closed === 'undefined') {
            showToast("Outlook-vinduet ble blokkert av popup-stopper. Teksten er kopiert til utklippstavlen!", "warning");
        } else {
            showToast("Outlook på nett åpnet med ferdig utfylt spesifikasjon! (Teksten er også kopiert)", "success");
        }
    } else if (method === 'client') {
        // Desktop mail program - hold tekststørrelse trygg under 1800 tegn for å unngå OS url-krasj
        let safeBody = bodyText;
        if (safeBody.length > 1800) {
            safeBody = safeBody.substring(0, 1750) + "\n\n[... Fullstendig spesifikasjon er kopiert til utklippstavlen. Trykk Ctrl+V / Lim inn for å se alt ...]";
        }

        let mailtoUrl = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}`;
        if (cc) mailtoUrl += `&cc=${encodeURIComponent(cc)}`;
        mailtoUrl += `&body=${encodeURIComponent(safeBody)}`;

        // Utløs via skjult lenke med target="_self" (aldri _blank for å unngå tomt Chrome-vindu)
        const a = document.createElement('a');
        a.href = mailtoUrl;
        a.target = '_self';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(() => a.remove(), 1000);

        showToast("E-postprogram forsøkes åpnet! Teksten er også kopiert til utklippstavlen (Ctrl+V).", "info");
    }
}

function copyAccountantSummary() {
    const commentInput = document.getElementById('acc-comment');
    const comment = commentInput ? commentInput.value.trim() : '';
    const bodyText = generateAccountantEmailText(comment);

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(bodyText).then(() => {
            showToast("Hele spesifikasjonen er kopiert til utklippstavlen! Du kan nå lime den rett inn.", "success");
        }).catch(() => {
            fallbackCopyText(bodyText);
        });
    } else {
        fallbackCopyText(bodyText);
    }
}

function fallbackCopyText(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        showToast("Hele spesifikasjonen er kopiert til utklippstavlen!", "success");
    } catch (e) {
        showToast("Kunne ikke kopiere automatisk. Marker og kopier teksten fra forhåndsvisningen under.", "error");
    }
    document.body.removeChild(ta);
}

function shareWithAccountant() {
    const commentInput = document.getElementById('acc-comment');
    const comment = commentInput ? commentInput.value.trim() : '';
    const subjectInput = document.getElementById('acc-subject');
    const subject = subjectInput && subjectInput.value ? subjectInput.value.trim() : 'Reiseregning 2026';
    const bodyText = generateAccountantEmailText(comment);

    if (navigator.share) {
        navigator.share({
            title: subject,
            text: bodyText
        }).then(() => {
            showToast("Reiseregningen ble delt!", "success");
        }).catch(err => {
            if (err.name !== 'AbortError') {
                showToast("Deling avbrutt eller ikke tilgjengelig.", "info");
            }
        });
    } else {
        copyAccountantSummary();
    }
}

window.onclick = function(event) {
    if (event.target && event.target.classList.contains('modal-overlay')) {
        closeModal();
    }
};
