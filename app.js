/* Qodo Guardian - FULLY FEATURED & CONNECTED TO BACKEND */
(function() {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
    const byId = id => document.getElementById(id);

    // Central place for your backend URL
    const API_BASE_URL = 'http://localhost:8080';

    const routes = {
        dashboard: renderDashboard,
        login: renderLogin,
        profile: renderProfile,
        history: renderHistory,
        help: renderHelp,
        about: renderAbout
    };

    const state = {
        user: getUser(),
        history: getHistory(),
    };

    function getUser() {
        try { return JSON.parse(localStorage.getItem('qodo:user') || 'null'); } catch { return null; }
    }
    function setUser(u) {
        localStorage.setItem('qodo:user', JSON.stringify(u));
        state.user = u;
        syncUserUI();
    }
    function getHistory() {
        try { return JSON.parse(localStorage.getItem('qodo:history') || '[]'); } catch { return []; }
    }
    function setHistory(h) {
        localStorage.setItem('qodo:history', JSON.stringify(h));
        state.history = h;
    }

    // Init
    document.addEventListener('DOMContentLoaded', () => {
        if (byId('year')) byId('year').textContent = new Date().getFullYear();
        bindNav();
        syncUserUI();
        route();
        window.addEventListener('hashchange', route);
    });

    // --- (All Navigation & Routing functions are unchanged) ---
    function bindNav() { /* ... code is unchanged ... */ }
    function route() { /* ... code is unchanged ... */ }
    function titleFromPath(p) { /* ... code is unchanged ... */ }
    function highlightNav(path) { /* ... code is unchanged ... */ }
    function syncUserUI() { /* ... code is unchanged ... */ }
    function requireAuth() { /* ... code is unchanged ... */ }

    // Views
    function renderDashboard() {
        const tpl = byId('view-dashboard');
        $('#app').appendChild(tpl.content.cloneNode(true));

        // Text detection is unchanged
        byId('analyzeMsgBtn').addEventListener('click', async () => {
            const text = byId('msgInput').value;
            if (!text.trim()) return toast('Please enter some text.');
            const resultEl = byId('msgResult');
            resultEl.innerHTML = 'Analyzing with Gemini...';
            try {
                const response = await fetch(`${API_BASE_URL}/analyze/text`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
                const data = await response.json();
                if (!data.success) throw new Error(data.msg || 'Analysis failed');
                resultEl.innerHTML = renderBackendResult(data.analysis);
                pushHistory({ type: 'msg', input: text.slice(0, 300), severity: data.analysis.verdict, details: [data.analysis.explanation] });
                drawGlobalHeatmap();
            } catch (err) {
                resultEl.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
            }
        });
        byId('clearMsgBtn').addEventListener('click', () => { byId('msgInput').value = ''; byId('msgResult').innerHTML = ''; byId('msgHeatmap').innerHTML = ''; });

        // Image detection is unchanged
        const imgInput = byId('imgInput');
        const imgCanvas = byId('imgCanvas');
        const analyzeImgBtn = byId('analyzeImgBtn');
        const clearImgBtn = byId('clearImgBtn');
        let currentImageFile = null;
        imgInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            currentImageFile = file;
            const img = new Image();
            img.onload = () => { imgCanvas.width = img.width; imgCanvas.height = img.height; imgCanvas.getContext('2d').drawImage(img, 0, 0); analyzeImgBtn.disabled = false; clearImgBtn.disabled = false; };
            img.src = URL.createObjectURL(file);
        });
        analyzeImgBtn.addEventListener('click', async () => {
            if (!currentImageFile) return toast('Please select an image file.');
            const resultEl = byId('imgResult');
            resultEl.innerHTML = 'Uploading and analyzing with Gemini...';
            const formData = new FormData();
            formData.append('file', currentImageFile);
            try {
                const response = await fetch(`${API_BASE_URL}/analyze/image`, { method: 'POST', body: formData });
                const data = await response.json();
                if (!data.success) throw new Error(data.msg || 'Image analysis failed');
                resultEl.innerHTML = renderBackendResult(data.analysis);
                pushHistory({ type: 'img', input: currentImageFile.name, severity: data.analysis.verdict, details: [data.analysis.explanation] });
                drawGlobalHeatmap();
            } catch (err) {
                resultEl.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
            }
        });
        clearImgBtn.addEventListener('click', () => { imgCanvas.getContext('2d').clearRect(0, 0, imgCanvas.width, imgCanvas.height); byId('imgResult').innerHTML = ''; analyzeImgBtn.disabled = true; clearImgBtn.disabled = true; imgInput.value = ''; currentImageFile = null; });

        // MODIFIED: Video detection is now connected to the backend
        const vidInput = byId('vidInput');
        const video = byId('video');
        const analyzeVidBtn = byId('analyzeVidBtn');
        const clearVidBtn = byId('clearVidBtn');
        let currentVideoFile = null; // Variable to hold the selected video

        vidInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            currentVideoFile = file; // Save the file
            video.src = URL.createObjectURL(file);
            analyzeVidBtn.disabled = false;
            clearVidBtn.disabled = false;
        });

        analyzeVidBtn.addEventListener('click', async () => {
            if (!currentVideoFile) return toast('Please select a video file.');

            const resultEl = byId('vidResult');
            resultEl.innerHTML = 'Uploading and analyzing video... (this may take a moment)';

            const formData = new FormData();
            formData.append('file', currentVideoFile);

            try {
                const response = await fetch(`${API_BASE_URL}/analyze/video`, {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (!data.success) throw new Error(data.msg || 'Video analysis failed');

                resultEl.innerHTML = renderBackendResult(data.analysis);
                pushHistory({ type: 'vid', input: currentVideoFile.name, severity: data.analysis.verdict, details: [data.analysis.explanation] });
                drawGlobalHeatmap();

            } catch (err) {
                resultEl.innerHTML = `<div style="color:var(--danger)">Error: ${err.message}</div>`;
            }
        });

        clearVidBtn.addEventListener('click', () => {
            video.removeAttribute('src');
            video.load();
            byId('vidResult').innerHTML = '';
            analyzeVidBtn.disabled = true;
            clearVidBtn.disabled = true;
            vidInput.value = '';
            currentVideoFile = null;
        });

        drawGlobalHeatmap();
    }

    // Login/Signup is unchanged
    function renderLogin() { /* ... code is unchanged ... */ }
    function renderProfile() { /* ... code is unchanged ... */ }
    function renderHistory() { /* ... code is unchanged ... */ }
    function renderHelp() { /* ... code is unchanged ... */ }
    function renderAbout() { /* ... code is unchanged ... */ }

    // --- (All Helper functions are unchanged) ---
    function renderBackendResult(analysis) { /* ... code is unchanged ... */ }
    function drawGlobalHeatmap() { /* ... code is unchanged ... */ }
    function mixColor(a,b,t){ /* ... code is unchanged ... */ }
    function roundRect(ctx, x,y,w,h,r){ /* ... code is unchanged ... */ }
    function aggregateHistory() { /* ... code is unchanged ... */ }
    function summarizeHistory() { /* ... code is unchanged ... */ }
    function pushHistory(entry) { /* ... code is unchanged ... */ }
    function buildHistoryList(list) { /* ... code is unchanged ... */ }
    function filterHistory(q) { /* ... code is unchanged ... */ }
    function toast(msg) { /* ... code is unchanged ... */ }
    function escapeHtml(s){ /* ... code is unchanged ... */ }

    // Re-pasting the unchanged functions to ensure completeness
    function bindNav() { $$('.nav-item').forEach(el => el.addEventListener('click', e => { if (el.dataset.route) window.location.hash = `#/${el.dataset.route}`; })); const signOut = byId('signOutBtn'); if (signOut) signOut.addEventListener('click', () => { setUser(null); window.location.hash = '#/login'; }); const search = byId('globalSearch'); if(search) search.addEventListener('input', e => { if (window.location.hash === '#/history') filterHistory(e.target.value.toLowerCase().trim()); }); const chip = byId('userChip'); if(chip) chip.addEventListener('click', () => window.location.hash = '#/profile');}
    function route() { const path = (location.hash || '#/dashboard').slice(2); if (path === 'login' && state.user) { location.hash = '#/dashboard'; return; } const view = routes[path] || renderDashboard; highlightNav(path); const titleEl = byId('pageTitle'); if(titleEl) titleEl.textContent = titleFromPath(path); const mount = $('#app'); if(mount) { mount.innerHTML = ''; view(); }}
    function titleFromPath(p) { return ({ dashboard: 'Dashboard', login: 'Sign In / Up', profile: 'Profile', history: 'History', help: 'Help', about: 'About' })[p] || 'Dashboard'; }
    function highlightNav(path) { $$('.nav-item').forEach(el => el.classList.remove('active')); const current = $(`.nav-item[data-route="${path}"]`); if(current) current.classList.add('active'); }
    function syncUserUI() { const isAuthed = !!state.user; const signOut = byId('signOutBtn'); if(signOut) signOut.style.display = isAuthed ? 'flex' : 'none'; const nameEl = byId('userName'); if(nameEl) nameEl.textContent = isAuthed ? state.user.name : 'Guest'; const avEl = byId('userAvatar'); if(avEl) avEl.textContent = (isAuthed ? state.user.name : 'Q').slice(0,1).toUpperCase(); const loginNav = $(`.nav-item[data-route="login"]`); if(loginNav) loginNav.style.display = isAuthed ? 'none' : 'flex';}
    function requireAuth() { if (!state.user) { window.location.hash = '#/login'; return false; } return true; }
    function renderBackendResult(analysis) { const confidence = (analysis.confidence * 100).toFixed(1); const severity = analysis.verdict || 'unknown'; const explanation = analysis.explanation || 'No explanation provided.'; return `<div>Verdict: <b>${severity.toUpperCase()}</b> • Confidence: <b>${confidence}%</b></div><div style="margin-top:8px; color: var(--muted);">${escapeHtml(explanation)}</div>`; }
    function drawGlobalHeatmap() { const canvas = byId('globalHeatmap'); if(!canvas) return; const ctx = canvas.getContext('2d'); const w = canvas.width = canvas.offsetWidth; const h = canvas.height; const data = aggregateHistory(); ctx.clearRect(0,0,w,h); const cols = 30; const rows = 8; const cellW = w / cols; const cellH = h / rows; for (let y=0; y<rows; y++) { for (let x=0; x<cols; x++) { const v = data[(y*cols + x) % data.length] || 0; const c = mixColor([34,211,238],[167,139,250], v); ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]}, ${0.1 + v*0.7})`; roundRect(ctx, x*cellW+2, y*cellH+2, cellW-4, cellH-4, 4); ctx.fill(); } } const summary = byId('globalSummary'); if(summary) summary.textContent = summarizeHistory(); }
    function mixColor(a,b,t){return [Math.round(a[0]*(1-t)+b[0]*t),Math.round(a[1]*(1-t)+b[1]*t),Math.round(a[2]*(1-t)+b[2]*t)];}
    function roundRect(ctx, x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
    function aggregateHistory() { if (!state.history.length) return new Array(60).fill(0.05); const severityMap = { low: 0.2, caution: 0.2, medium: 0.5, misinformation: 0.9, high: 0.9, safe: 0.1 }; return state.history.map(h => severityMap[h.severity] || 0.1).slice(-240); }
    function summarizeHistory() { const c = { msg:0, img:0, vid:0 }; state.history.forEach(h => c[h.type]++); const total = state.history.length; const sevC = { low:0, medium:0, high:0, caution: 0, misinformation: 0, safe: 0 }; state.history.forEach(h => { if(sevC[h.severity] !== undefined) sevC[h.severity]++; }); return `Total: ${total} • Msg: ${c.msg} • Img: ${c.img} • Vid: ${c.vid}`; }
    function pushHistory(entry) { const record = { id: Date.now(), ts: new Date().toISOString(), ...entry }; const next = [record, ...state.history].slice(0, 300); setHistory(next); if (location.hash === '#/history') buildHistoryList(next); }
    function buildHistoryList(list) { const container = byId('historyList'); if (!container) return; container.innerHTML = ''; list.forEach(item => { const el = document.createElement('div'); el.className = 'history-item'; const badge = item.type === 'msg' ? 'msg' : item.type === 'img' ? 'img' : 'vid'; el.innerHTML = `<div><span class="badge ${badge}">${item.type.toUpperCase()}</span><span class="muted"> • ${new Date(item.ts).toLocaleString()}</span><div class="muted small">${escapeHtml((item.input || '').toString()).slice(0, 120)}</div></div><div class="severity">${(item.severity || 'N/A').toUpperCase()}</div>`; container.appendChild(el); }); }
    function filterHistory(q) { const filtered = state.history.filter(h => (h.input||'').toLowerCase().includes(q)); buildHistoryList(filtered); }
    function toast(msg) { let el = byId('toast'); if (!el) { el = document.createElement('div'); el.id = 'toast'; el.style.position = 'fixed'; el.style.right = '16px'; el.style.bottom = '16px'; el.style.padding = '12px 14px'; el.style.border = '1px solid var(--line)'; el.style.borderRadius = '10px'; el.style.background = 'var(--elev)'; el.style.boxShadow = 'var(--shadow)'; el.style.color = 'var(--text)'; document.body.appendChild(el); } el.textContent = msg; el.style.opacity = '1'; setTimeout(()=>{ el.style.opacity = '0'; }, 1800); }
    function escapeHtml(s){return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));}
    function renderLogin() { const tpl = byId('view-login'); $('#app').appendChild(tpl.content.cloneNode(true)); const tabBtns = $$('.tab'); tabBtns.forEach(btn => btn.addEventListener('click', () => selectTab(btn.dataset.tab))); byId('signinBtn').addEventListener('click', async () => { const email = byId('signinEmail').value.trim(); const password = byId('signinPassword').value; if (!email || !password) return toast('Enter email and password'); try { const response = await fetch(`${API_BASE_URL}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const data = await response.json(); if (!data.success) throw new Error(data.msg || 'Login failed'); setUser({ name: email.split('@')[0], email: email, bio: '' }); toast('Signed in successfully'); window.location.hash = '#/dashboard'; } catch (err) { toast(`Error: ${err.message}`); } }); byId('signupBtn').addEventListener('click', async () => { const email = byId('signupEmail').value.trim(); const password = byId('signupPassword').value; if (!email || !password) return toast('Please fill in email and password'); try { const response = await fetch(`${API_BASE_URL}/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const data = await response.json(); if (!data.success) throw new Error(data.msg || 'Signup failed'); setUser({ name: email.split('@')[0], email: email, bio: '' }); toast('Account created successfully'); window.location.hash = '#/dashboard'; } catch (err) { toast(`Error: ${err.message}`); } }); function selectTab(name) { tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === name)); $$('.tab-content').forEach(el => el.classList.toggle('show', el.id === 'tab-' + name)); } }
    function renderProfile() { if (!requireAuth()) return; const tpl = byId('view-profile'); $('#app').appendChild(tpl.content.cloneNode(true)); const u = state.user; byId('profileAvatar').textContent = u.name.slice(0, 1).toUpperCase(); byId('profileName').value = u.name; byId('profileEmail').value = u.email; byId('profileBio').value = u.bio || ''; byId('saveProfileBtn').addEventListener('click', () => { const name = byId('profileName').value.trim() || 'User'; const bio = byId('profileBio').value; setUser({ ...state.user, name, bio }); toast('Profile saved'); }); byId('resetProfileBtn').addEventListener('click', () => route()); }
    function renderHistory() { const tpl = byId('view-history'); $('#app').appendChild(tpl.content.cloneNode(true)); buildHistoryList(state.history); byId('exportHistoryBtn').addEventListener('click', () => { const blob = new Blob([JSON.stringify(state.history, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'qodo-history.json'; a.click(); }); byId('clearHistoryBtn').addEventListener('click', () => { setHistory([]); buildHistoryList([]); drawGlobalHeatmap(); }); }
    function renderHelp() { const tpl = byId('view-help'); $('#app').appendChild(tpl.content.cloneNode(true)); }
    function renderAbout() { const tpl = byId('view-about'); $('#app').appendChild(tpl.content.cloneNode(true)); }

})();