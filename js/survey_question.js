// survey_question.js
// ✅ Direct Supabase integration — no Flask/Python backend required.
// Requires: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// and a supabase_client.js that exposes `window.supabaseClient`

document.addEventListener('DOMContentLoaded', () => {
    // ==================== DOM ELEMENTS ====================
    const editBtn = document.getElementById('editToggleBtn');
    const addPageBtn = document.getElementById('addPageBtn');
    const newPagePlaceholder = document.getElementById('newPagePlaceholder');

    let isEditMode = false;
    let selectedPageType = null;
    let dynamicCardCounter = 0;
    let pendingDeleteCallback = null;
    let currentSurveyId = null;
    let surveySnapshot = null; // tracks last-saved state

// ==================== FIX extractSurveyState ====================
function extractSurveyState() {
    const pages = [];
    document.querySelectorAll('.sq-page-block').forEach(page => {
        const isMC      = !!page.querySelector('.multiple-choice-questions-container');
        const isLikert  = !!page.querySelector('.likert-questions-container');
        const isComment = !!page.querySelector('.comment-questions-container');
        if (!isMC && !isLikert && !isComment) return;

        const instruction = page.querySelector('.card-instruction')?.value.trim() || '';
        const questions   = [];

        if (isMC) {
            page.querySelectorAll('.mc-question-item').forEach(q => {
                const text       = q.querySelector('.mc-question-text')?.value.trim() || '';
                const selectType = q.querySelector('.mc-select-type')?.value || 'radio';
                const options    = [...q.querySelectorAll('.mc-option-item input[type="text"]')]
                    .map(o => o.value.trim());
                questions.push({
                    question_text: text,     // ← CHANGED
                    selectType,
                    options
                });
            });
            pages.push({ type: 'multiple-choice', instruction, questions });
        }
        else if (isLikert) {
            page.querySelectorAll('.likert-question-item').forEach(q => {
                questions.push({
                    question_text: q.querySelector('.likert-question-text')?.value.trim() || ''
                });
            });
            pages.push({ type: 'likert', instruction, questions });
        }
        else if (isComment) {
            page.querySelectorAll('.comment-question-item').forEach(q => {
                questions.push({
                    question_text: q.querySelector('.comment-question-text')?.value.trim() || ''
                });
            });
            pages.push({ type: 'comment', instruction, questions });
        }
    });
    return JSON.stringify(pages);
}

    // Static cards that should never be removed
    const staticCardIds = ['card1', 'card2'];

    // Initially hide Add Page button and the placeholder
    addPageBtn.style.display = 'none';
    if (newPagePlaceholder) newPagePlaceholder.style.display = 'none';

    // ==================== SUPABASE CLIENT ====================
    // Expects supabase_client.js loaded before this file:
    //   const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const db = window.supabaseClient;

    if (!db) {
        console.error('❌ supabaseClient not found. Make sure supabase_client.js is loaded before survey_question.js');
    }

    // ==================== SAVE BUTTON SETUP ====================
    let saveBtn = document.getElementById('saveBtn');
    if (!saveBtn) {
        saveBtn = document.createElement('button');
        saveBtn.id = 'saveBtn';
        saveBtn.className = 'btn-save';
        saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Survey';
        saveBtn.style.cssText = `
            background: #10b981;
            color: white;
            border: none;
            padding: 0.6rem 1.2rem;
            border-radius: 8px;
            font-size: 0.9rem;
            font-weight: 500;
            cursor: pointer;
            display: none;
            align-items: center;
            gap: 0.5rem;
            transition: all 0.2s;
            margin-right: 0.5rem;
        `;
        saveBtn.addEventListener('mouseenter', () => {
            saveBtn.style.background = '#059669';
            saveBtn.style.transform = 'translateY(-1px)';
        });
        saveBtn.addEventListener('mouseleave', () => {
            saveBtn.style.background = '#10b981';
            saveBtn.style.transform = 'translateY(0)';
        });
        if (editBtn && editBtn.parentNode) {
            editBtn.parentNode.insertBefore(saveBtn, editBtn);
        }
    }

    saveBtn.style.display = 'none';

    // ==================== HELPER FUNCTIONS ====================
    function showToast(message, color = '#10b981') {
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
            pointer-events: none;
        `;
        if (!document.querySelector('#toast-style')) {
            const style = document.createElement('style');
            style.id = 'toast-style';
            style.textContent = `@keyframes slideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
            document.head.appendChild(style);
        }
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function generateDynamicCardId() {
        dynamicCardCounter++;
        return `dynamic-card-${dynamicCardCounter}`;
    }

    function countDynamicCards() {
        const allCards = document.querySelectorAll('#surveyCardsContainer > .card');
        let count = 0;
        allCards.forEach(card => {
            const cardId = card.getAttribute('data-card-id');
            if (cardId && !staticCardIds.includes(cardId)) count++;
        });
        return count;
    }

    function updateStepNumbers() {
    const dynamicPageBlocks = document.querySelectorAll('.sq-page-block.dynamic-page');
    // ✅ Exclude the placeholder from the static count
    const staticPageCount = document.querySelectorAll('.sq-page-block:not(.dynamic-page):not(#newPagePlaceholder)').length;

    dynamicPageBlocks.forEach((block, idx) => {
        const pageNumber = staticPageCount + idx + 1;
        const label = block.querySelector('.sq-page-label');
        if (label) label.textContent = `Page ${pageNumber}`;

        const sectionTitle = block.querySelector('.section-title');
        if (sectionTitle) {
            const total = staticPageCount + dynamicPageBlocks.length;
            const type = block.getAttribute('data-page-type');
            let typeLabel = 'Survey Question';
            if (type === 'multiple-choice') typeLabel = 'Multiple Choice';
            else if (type === 'likert') typeLabel = 'Satisfaction / Likert Scale';
            else if (type === 'comment') typeLabel = 'Comment / Open-ended';
            sectionTitle.setAttribute('data-step-label', `${typeLabel} Page ${pageNumber} of ${total}`);
        }
    });
}

    function applyEditModeToPage(page, editModeOn) {
        const actionBtns = page.querySelectorAll(
            '.delete-card-btn, .remove-question-btn, .add-question-btn, .add-option-btn, .trash-option-btn'
        );
        actionBtns.forEach(btn => {
            btn.style.display = editModeOn ? '' : 'none';
        });

        const allInputs = page.querySelectorAll('input, select, textarea');
        allInputs.forEach(input => {
            input.disabled = !editModeOn;
            input.style.opacity = editModeOn ? '1' : '0.6';
            input.style.pointerEvents = editModeOn ? 'auto' : 'none';
        });
    }

    function enableAllInputs(enable) {
        document.querySelectorAll('.sq-page-block').forEach(page => {
            applyEditModeToPage(page, enable);
        });
    }

    // ==================== SCROLL TO TOP ====================
    function createScrollToTopButton() {
        const scrollBtn = document.createElement('button');
        scrollBtn.id = 'scrollToTopBtn';
        scrollBtn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        scrollBtn.style.cssText = `
            position: fixed; bottom: 30px; right: 30px;
            width: 50px; height: 50px; border-radius: 50%;
            background: #2563eb; color: white; border: none;
            cursor: pointer; display: none; align-items: center;
            justify-content: center; font-size: 1.2rem;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: all 0.3s ease; z-index: 1000;
            opacity: 0; transform: scale(0.8);
        `;
        scrollBtn.addEventListener('mouseenter', () => { scrollBtn.style.background = '#1d4ed8'; scrollBtn.style.transform = 'scale(1.1)'; });
        scrollBtn.addEventListener('mouseleave', () => { scrollBtn.style.background = '#2563eb'; scrollBtn.style.transform = 'scale(1)'; });
        scrollBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
        document.body.appendChild(scrollBtn);

        window.addEventListener('scroll', () => {
            if (window.pageYOffset > 300) {
                scrollBtn.style.display = 'flex';
                setTimeout(() => { scrollBtn.style.opacity = '1'; scrollBtn.style.transform = 'scale(1)'; }, 10);
            } else {
                scrollBtn.style.opacity = '0';
                scrollBtn.style.transform = 'scale(0.8)';
                setTimeout(() => { if (window.pageYOffset <= 300) scrollBtn.style.display = 'none'; }, 300);
            }
        });
    }

    createScrollToTopButton();

    // ==================== CUSTOM CONFIRMATION MODAL ====================
    function createConfirmationModal() {
        const modalHTML = `
            <div id="customConfirmModal" class="custom-modal" style="display: none;">
                <div class="custom-modal-content">
                    <div class="custom-modal-header">
                        <i class="fas fa-exclamation-triangle" style="color: #f59e0b;"></i>
                        <h3>Confirm Deletion</h3>
                    </div>
                    <div class="custom-modal-body">
                        <p>Are you sure you want to delete this item? This action cannot be undone.</p>
                    </div>
                    <div class="custom-modal-footer">
                        <button id="confirmCancelBtn" class="modal-btn cancel-btn">Cancel</button>
                        <button id="confirmDeleteBtn" class="modal-btn delete-btn">Delete</button>
                    </div>
                </div>
            </div>
        `;
        if (!document.getElementById('customConfirmModal')) {
            document.body.insertAdjacentHTML('beforeend', modalHTML);
            const style = document.createElement('style');
            style.textContent = `
                .custom-modal { position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:10000; backdrop-filter:blur(4px); }
                .custom-modal-content { background:white; border-radius:16px; max-width:400px; width:90%; box-shadow:0 20px 25px -5px rgba(0,0,0,0.1); animation:modalSlideIn 0.3s ease; }
                @keyframes modalSlideIn { from { transform:translateY(-50px); opacity:0; } to { transform:translateY(0); opacity:1; } }
                .custom-modal-header { padding:1.5rem 1.5rem 0.5rem; display:flex; align-items:center; gap:0.75rem; border-bottom:1px solid #e5e7eb; }
                .custom-modal-header i { font-size:1.5rem; }
                .custom-modal-header h3 { font-size:1.25rem; font-weight:600; color:#111827; margin:0; }
                .custom-modal-body { padding:1.5rem; }
                .custom-modal-body p { color:#4b5563; font-size:0.95rem; line-height:1.5; margin:0; }
                .custom-modal-footer { padding:1rem 1.5rem 1.5rem; display:flex; justify-content:flex-end; gap:0.75rem; }
                .modal-btn { padding:0.5rem 1.25rem; border-radius:8px; font-size:0.875rem; font-weight:500; cursor:pointer; transition:all 0.2s; border:none; }
                .cancel-btn { background:#f3f4f6; color:#374151; }
                .cancel-btn:hover { background:#e5e7eb; }
                .delete-btn { background:#dc2626; color:white; }
                .delete-btn:hover { background:#b91c1c; }
                .btn-save.saving { background:#f59e0b; cursor:wait; }
                .btn-save.saved { background:#10b981; }
            `;
            document.head.appendChild(style);
        }

        const modalElement = document.getElementById('customConfirmModal');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        const confirmBtn = document.getElementById('confirmDeleteBtn');

        const show = (callback) => { pendingDeleteCallback = callback; modalElement.style.display = 'flex'; };
        const hide = () => { modalElement.style.display = 'none'; pendingDeleteCallback = null; };

        cancelBtn.onclick = () => hide();
        confirmBtn.onclick = () => { if (pendingDeleteCallback) { pendingDeleteCallback(); hide(); } };
        modalElement.onclick = (e) => { if (e.target === modalElement) hide(); };

        return { show, hide };
    }

    const confirmationModal = createConfirmationModal();

    // ==================== QUESTION ITEM BUILDERS ====================

    function createOptionItem(value, index) {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'mc-option-item';
        optionDiv.style.cssText = 'display:flex; align-items:center; gap:0.6rem;';

        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.placeholder = `Option ${index + 1}`;
        input.style.cssText = 'flex:1; padding:0.6rem 0.8rem; border:1px solid #e5e7eb; border-radius:8px; font-size:0.9rem;';

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'trash-option-btn';
        removeBtn.innerHTML = '<i class="fas fa-trash-alt"></i>';
        removeBtn.style.cssText = 'background:none; border:none; color:#ef4444; cursor:pointer; padding:0.4rem; border-radius:6px; transition:all 0.2s; font-size:0.9rem; display:none;';
        removeBtn.addEventListener('mouseenter', () => { removeBtn.style.background = '#fee2e2'; });
        removeBtn.addEventListener('mouseleave', () => { removeBtn.style.background = 'none'; });
        removeBtn.addEventListener('click', () => {
            const optionsList = optionDiv.parentElement;
            if (optionsList.children.length <= 1) { showToast('You need at least one option', '#f59e0b'); return; }
            optionDiv.remove();
            showToast('Option removed', '#ef4444');
        });

        optionDiv.appendChild(input);
        optionDiv.appendChild(removeBtn);
        return optionDiv;
    }

    function createOptionsContainer() {
        const optionsWrapper = document.createElement('div');
        optionsWrapper.className = 'mc-options-wrapper';
        optionsWrapper.style.marginBottom = '0.8rem';

        const optionsList = document.createElement('div');
        optionsList.className = 'mc-options-list';
        optionsList.style.cssText = 'display:flex; flex-direction:column; gap:0.6rem; margin-bottom:0.8rem;';

        ['Option 1', 'Option 2'].forEach((val, idx) => optionsList.appendChild(createOptionItem(val, idx)));

        const addOptionBtn = document.createElement('button');
        addOptionBtn.type = 'button';
        addOptionBtn.className = 'add-option-btn';
        addOptionBtn.innerHTML = '<i class="fas fa-plus-circle"></i> Add Option';
        addOptionBtn.style.cssText = 'background:#f3f4f6; border:1px dashed #cbd5e1; padding:0.5rem 1rem; border-radius:8px; font-size:0.85rem; font-weight:500; color:#2563eb; cursor:pointer; display:none; align-items:center; gap:0.5rem; transition:all 0.2s; width:auto;';
        addOptionBtn.addEventListener('mouseenter', () => { addOptionBtn.style.background = '#eef2ff'; addOptionBtn.style.borderColor = '#2563eb'; });
        addOptionBtn.addEventListener('mouseleave', () => { addOptionBtn.style.background = '#f3f4f6'; addOptionBtn.style.borderColor = '#cbd5e1'; });

        let optionCounter = 2;
        addOptionBtn.addEventListener('click', () => {
            optionCounter++;
            optionsList.appendChild(createOptionItem(`Option ${optionCounter}`, optionCounter - 1));
            showToast('Option added', '#10b981');
        });

        optionsWrapper.appendChild(optionsList);
        optionsWrapper.appendChild(addOptionBtn);
        return optionsWrapper;
    }

    function renumberMultipleChoiceQuestions(card) {
        const container = card.querySelector('.multiple-choice-questions-container');
        if (!container) return;
        container.querySelectorAll('.mc-question-item').forEach((q, idx) => {
            const label = q.querySelector('h4');
            if (label) { label.innerHTML = `<i class="fas fa-question-circle"></i> Question ${idx + 1}`; q.setAttribute('data-question-index', idx + 1); }
        });
        if (card._questionCount !== undefined) card._questionCount = container.querySelectorAll('.mc-question-item').length;
    }

    function renumberLikertQuestions(card) {
        const container = card.querySelector('.likert-questions-container');
        if (!container) return;
        container.querySelectorAll('.likert-question-item').forEach((q, idx) => {
            const label = q.querySelector('h4');
            if (label) { label.innerHTML = `<i class="fas fa-chart-line"></i> Question ${idx + 1}`; q.setAttribute('data-question-index', idx + 1); }
        });
        if (card._questionCount !== undefined) card._questionCount = container.querySelectorAll('.likert-question-item').length;
    }

    function renumberCommentQuestions(card) {
        const container = card.querySelector('.comment-questions-container');
        if (!container) return;
        container.querySelectorAll('.comment-question-item').forEach((q, idx) => {
            const label = q.querySelector('h4');
            if (label) { label.innerHTML = `<i class="fas fa-comment-dots"></i> Question ${idx + 1}`; q.setAttribute('data-question-index', idx + 1); }
        });
        if (card._questionCount !== undefined) card._questionCount = container.querySelectorAll('.comment-question-item').length;
    }

    function createMultipleChoiceQuestion(card, questionNumber) {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'mc-question-item';
        questionDiv.style.cssText = 'border:1px solid #e5e7eb; border-radius:12px; padding:1.2rem; margin-bottom:1.2rem; background:#fafafa; transition:all 0.2s;';
        questionDiv.setAttribute('data-question-index', questionNumber);

        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;';

        const questionLabel = document.createElement('h4');
        questionLabel.style.cssText = 'font-size:1rem; font-weight:600; color:#2563eb; margin:0;';
        questionLabel.innerHTML = `<i class="fas fa-question-circle"></i> Question ${questionNumber}`;

        const removeQuestionBtn = document.createElement('button');
        removeQuestionBtn.type = 'button';
        removeQuestionBtn.className = 'remove-question-btn';
        removeQuestionBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Remove Question';
        removeQuestionBtn.style.cssText = 'background:#fee2e2; border:none; padding:0.3rem 0.8rem; border-radius:6px; font-size:0.75rem; color:#dc2626; cursor:pointer; display:none; align-items:center; gap:0.4rem; transition:all 0.2s;';
        removeQuestionBtn.addEventListener('mouseenter', () => { removeQuestionBtn.style.background = '#fecaca'; });
        removeQuestionBtn.addEventListener('mouseleave', () => { removeQuestionBtn.style.background = '#fee2e2'; });
        removeQuestionBtn.addEventListener('click', () => {
            confirmationModal.show(() => {
                questionDiv.remove();
                renumberMultipleChoiceQuestions(card);
                showToast('Question removed', '#ef4444');
            });
        });

        headerDiv.appendChild(questionLabel);
        headerDiv.appendChild(removeQuestionBtn);

        const questionInput = document.createElement('div');
        questionInput.className = 'form-group';
        questionInput.style.marginBottom = '1rem';
        questionInput.innerHTML = `
            <label>Question Text <span style="color:#dc2626;">*</span></label>
            <input type="text" class="mc-question-text" placeholder="Enter your question here..." required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box;">
        `;

        const optionsGroup = document.createElement('div');
        optionsGroup.className = 'form-group';
        optionsGroup.innerHTML = `
            <label>Options <span style="color:#dc2626;">*</span></label>
            <div class="mc-options-area"></div>
            <small class="help-text" style="color:#64748b; font-size:0.8rem;">Click "Add Option" to add more choices.</small>
        `;
        optionsGroup.querySelector('.mc-options-area').appendChild(createOptionsContainer());

        const selectionGroup = document.createElement('div');
        selectionGroup.className = 'form-group';
        selectionGroup.innerHTML = `
            <label>Selection type</label>
            <select class="mc-select-type" style="width:100%; padding:8px; border:1px solid #ddd; border-radius:8px;">
                <option value="radio">Single select (Radio buttons)</option>
                <option value="checkbox">Multiple select (Checkboxes)</option>
            </select>
        `;

        questionDiv.appendChild(headerDiv);
        questionDiv.appendChild(questionInput);
        questionDiv.appendChild(optionsGroup);
        questionDiv.appendChild(selectionGroup);
        return questionDiv;
    }

    function createLikertQuestion(card, questionNumber) {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'likert-question-item';
        questionDiv.style.cssText = 'border:1px solid #e5e7eb; border-radius:12px; padding:1.2rem; margin-bottom:1.2rem; background:#fafafa; transition:all 0.2s;';
        questionDiv.setAttribute('data-question-index', questionNumber);

        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;';

        const questionLabel = document.createElement('h4');
        questionLabel.style.cssText = 'font-size:1rem; font-weight:600; color:#2563eb; margin:0;';
        questionLabel.innerHTML = `<i class="fas fa-chart-line"></i> Question ${questionNumber}`;

        const removeQuestionBtn = document.createElement('button');
        removeQuestionBtn.type = 'button';
        removeQuestionBtn.className = 'remove-question-btn';
        removeQuestionBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Remove Question';
        removeQuestionBtn.style.cssText = 'background:#fee2e2; border:none; padding:0.3rem 0.8rem; border-radius:6px; font-size:0.75rem; color:#dc2626; cursor:pointer; display:none; align-items:center; gap:0.4rem; transition:all 0.2s;';
        removeQuestionBtn.addEventListener('mouseenter', () => { removeQuestionBtn.style.background = '#fecaca'; });
        removeQuestionBtn.addEventListener('mouseleave', () => { removeQuestionBtn.style.background = '#fee2e2'; });
        removeQuestionBtn.addEventListener('click', () => {
            confirmationModal.show(() => {
                questionDiv.remove();
                renumberLikertQuestions(card);
                showToast('Question removed', '#ef4444');
            });
        });

        headerDiv.appendChild(questionLabel);
        headerDiv.appendChild(removeQuestionBtn);

        const questionInput = document.createElement('div');
        questionInput.className = 'form-group';
        questionInput.style.marginBottom = '1rem';
        questionInput.innerHTML = `
            <label>Question Text <span style="color:#dc2626;">*</span></label>
            <input type="text" class="likert-question-text" placeholder="Enter your question here..." required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box;">
        `;

        const scaleGroup = document.createElement('div');
        scaleGroup.className = 'form-group';
        scaleGroup.innerHTML = `
            <label>Rating Scale (5-point)</label>
            <div class="likert-scale-container" style="display:flex; flex-wrap:wrap; justify-content:center; gap:12px; margin-top:12px;">
                <div class="scale-option" data-value="1" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/angry.png" alt="Very Unsatisfied" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Lubos na Hindi Sumasang-ayon</span>
                </div>
                <div class="scale-option" data-value="2" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/sad.png" alt="Unsatisfied" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Hindi Sumasang-ayon</span>
                </div>
                <div class="scale-option" data-value="3" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/neutral.png" alt="Neutral" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Walang Opinyon</span>
                </div>
                <div class="scale-option" data-value="4" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/smile.png" alt="Satisfied" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Sumasang-ayon</span>
                </div>
                <div class="scale-option" data-value="5" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/happy.png" alt="Very Satisfied" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Labis na Sumasang-ayon</span>
                </div>
                <div class="scale-option" data-value="NA" style="display:flex; flex-direction:column; align-items:center; gap:6px; padding:8px 12px; border:1px solid #e5e7eb; border-radius:12px; min-width:70px; cursor:pointer;">
                    <img src="../images/na.png" alt="Not Applicable" style="width:40px; height:40px; object-fit:contain;">
                    <span style="font-size:0.7rem; text-align:center;">Hindi Naaangkop</span>
                </div>
            </div>
            <small class="help-text" style="color:#64748b; font-size:0.8rem; display:block; margin-top:10px;">Preview: Respondents will see these emoji options</small>
        `;

        questionDiv.appendChild(headerDiv);
        questionDiv.appendChild(questionInput);
        questionDiv.appendChild(scaleGroup);
        return questionDiv;
    }

    function createCommentQuestion(card, questionNumber) {
        const questionDiv = document.createElement('div');
        questionDiv.className = 'comment-question-item';
        questionDiv.style.cssText = 'border:1px solid #e5e7eb; border-radius:12px; padding:1.2rem; margin-bottom:1.2rem; background:#fafafa; transition:all 0.2s;';
        questionDiv.setAttribute('data-question-index', questionNumber);

        const headerDiv = document.createElement('div');
        headerDiv.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;';

        const questionLabel = document.createElement('h4');
        questionLabel.style.cssText = 'font-size:1rem; font-weight:600; color:#2563eb; margin:0;';
        questionLabel.innerHTML = `<i class="fas fa-comment-dots"></i> Question ${questionNumber}`;

        const removeQuestionBtn = document.createElement('button');
        removeQuestionBtn.type = 'button';
        removeQuestionBtn.className = 'remove-question-btn';
        removeQuestionBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Remove Question';
        removeQuestionBtn.style.cssText = 'background:#fee2e2; border:none; padding:0.3rem 0.8rem; border-radius:6px; font-size:0.75rem; color:#dc2626; cursor:pointer; display:none; align-items:center; gap:0.4rem; transition:all 0.2s;';
        removeQuestionBtn.addEventListener('mouseenter', () => { removeQuestionBtn.style.background = '#fecaca'; });
        removeQuestionBtn.addEventListener('mouseleave', () => { removeQuestionBtn.style.background = '#fee2e2'; });
        removeQuestionBtn.addEventListener('click', () => {
            confirmationModal.show(() => {
                questionDiv.remove();
                renumberCommentQuestions(card);
                showToast('Question removed', '#ef4444');
            });
        });

        headerDiv.appendChild(questionLabel);
        headerDiv.appendChild(removeQuestionBtn);

        const questionInput = document.createElement('div');
        questionInput.className = 'form-group';
        questionInput.style.marginBottom = '1rem';
        questionInput.innerHTML = `
            <label>Question Text <span style="color:#dc2626;">*</span></label>
            <input type="text" class="comment-question-text" placeholder="Enter your question here..." required style="width:100%; padding:10px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box;">
        `;

        const answerArea = document.createElement('div');
        answerArea.className = 'form-group';
        answerArea.innerHTML = `
            <label>Answer Area Preview</label>
            <textarea class="comment-answer-area" rows="4" placeholder="Type your answer here..." style="width:100%; resize:vertical; padding:10px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box;"></textarea>
            <small class="help-text" style="color:#64748b; font-size:0.8rem;">Multi-line text response</small>
        `;

        questionDiv.appendChild(headerDiv);
        questionDiv.appendChild(questionInput);
        questionDiv.appendChild(answerArea);
        return questionDiv;
    }

    function createInstructionInput() {
        const instructionGroup = document.createElement('div');
        instructionGroup.className = 'form-group';
        instructionGroup.style.marginBottom = '1.5rem';
        instructionGroup.innerHTML = `
            <label><i class="fas fa-info-circle"></i> Instruction (Optional)</label>
            <textarea class="card-instruction" rows="2" placeholder="Add instructions for this section (e.g., Please provide detailed feedback...)" style="width:100%; resize:vertical; padding:10px; border:1px solid #ddd; border-radius:8px; box-sizing:border-box;"></textarea>
            <small class="help-text" style="color:#64748b; font-size:0.8rem;">Provide guidance or context for the questions in this section</small>
        `;
        return instructionGroup;
    }

    // ==================== PAGE BLOCK CREATION ====================

    function createPageBlock(type, pageId) {
        const page = document.createElement('div');
        page.className = 'sq-page-block';
        page.setAttribute('data-page-type', type);
        if (pageId) page.id = pageId;
        page._questionCount = 0;

        const pageLabel = document.createElement('div');
        pageLabel.className = 'sq-page-label';
        pageLabel.textContent = 'Page';

        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'card';
        cardWrapper.style.cssText = 'background:#fff; border-radius:12px; padding:20px; box-shadow:0 2px 10px rgba(0,0,0,0.08); margin-bottom:20px;';

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'delete-card-btn';
        deleteBtn.innerHTML = '<i class="fas fa-trash-alt"></i> Remove Page';
        deleteBtn.style.cssText = 'float:right; background:#fee2e2; border:none; padding:0.4rem 0.9rem; border-radius:20px; font-size:0.75rem; font-weight:500; color:#dc2626; cursor:pointer; display:none; align-items:center; gap:0.4rem; transition:all 0.2s; margin-bottom:0.5rem;';
        deleteBtn.addEventListener('mouseenter', () => { deleteBtn.style.background = '#fecaca'; deleteBtn.style.transform = 'scale(1.02)'; });
        deleteBtn.addEventListener('mouseleave', () => { deleteBtn.style.background = '#fee2e2'; deleteBtn.style.transform = 'scale(1)'; });
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmationModal.show(() => {
                page.remove();
                showToast('Page removed', '#ef4444');
                updateStepNumbers();
            });
        });

        const titleDiv = document.createElement('div');
        titleDiv.className = 'section-title';
        titleDiv.style.cssText = 'font-size:1.1rem; font-weight:600; margin:15px 0 20px 0; color:#1e293b;';

        const instructionInput = createInstructionInput();

        const questionsContainer = document.createElement('div');
        const addQuestionBtnContainer = document.createElement('div');
        addQuestionBtnContainer.className = 'form-group';
        addQuestionBtnContainer.style.marginTop = '1rem';

        const addQuestionBtn = document.createElement('button');
        addQuestionBtn.type = 'button';
        addQuestionBtn.className = 'add-question-btn';
        addQuestionBtn.innerHTML = '<i class="fas fa-plus"></i> Add Another Question';
        addQuestionBtn.style.cssText = 'background:#2563eb; color:white; border:none; padding:0.6rem 1.2rem; border-radius:8px; font-size:0.9rem; font-weight:500; cursor:pointer; display:none; align-items:center; gap:0.5rem; transition:all 0.2s;';
        addQuestionBtn.addEventListener('mouseenter', () => { addQuestionBtn.style.background = '#1d4ed8'; });
        addQuestionBtn.addEventListener('mouseleave', () => { addQuestionBtn.style.background = '#2563eb'; });
        addQuestionBtnContainer.appendChild(addQuestionBtn);

        if (type === 'multiple-choice') {
            titleDiv.innerHTML = '<i class="fas fa-check-square"></i> Multiple Choice Questions';
            questionsContainer.className = 'multiple-choice-questions-container';
            const addNewQuestion = () => {
                page._questionCount++;
                const newQ = createMultipleChoiceQuestion(page, page._questionCount);
                questionsContainer.appendChild(newQ);
                applyEditModeToPage(page, isEditMode);
                setTimeout(() => newQ.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                showToast('New question added', '#10b981');
            };
            addQuestionBtn.addEventListener('click', addNewQuestion);
            addNewQuestion();
        } else if (type === 'likert') {
            titleDiv.innerHTML = '<i class="fas fa-chart-line"></i> Satisfaction / Likert Scale Questions';
            questionsContainer.className = 'likert-questions-container';
            const addNewQuestion = () => {
                page._questionCount++;
                const newQ = createLikertQuestion(page, page._questionCount);
                questionsContainer.appendChild(newQ);
                applyEditModeToPage(page, isEditMode);
                setTimeout(() => newQ.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                showToast('New satisfaction question added', '#10b981');
            };
            addQuestionBtn.addEventListener('click', addNewQuestion);
            addNewQuestion();
        } else if (type === 'comment') {
            titleDiv.innerHTML = '<i class="fas fa-comment-dots"></i> Comment / Open-ended Questions';
            questionsContainer.className = 'comment-questions-container';
            const addNewQuestion = () => {
                page._questionCount++;
                const newQ = createCommentQuestion(page, page._questionCount);
                questionsContainer.appendChild(newQ);
                applyEditModeToPage(page, isEditMode);
                setTimeout(() => newQ.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
                showToast('New comment question added', '#10b981');
            };
            addQuestionBtn.addEventListener('click', addNewQuestion);
            addNewQuestion();
        }

        const saveIndicator = document.createElement('div');
        saveIndicator.style.cssText = 'margin-top:1rem; font-size:0.7rem; color:#94a3b8; display:flex; justify-content:flex-end; align-items:center; gap:0.5rem;';
        saveIndicator.innerHTML = '<i class="fas fa-save"></i> Draft saved automatically';

        cardWrapper.appendChild(deleteBtn);
        cardWrapper.appendChild(titleDiv);
        cardWrapper.appendChild(instructionInput);
        cardWrapper.appendChild(questionsContainer);
        cardWrapper.appendChild(addQuestionBtnContainer);
        cardWrapper.appendChild(saveIndicator);

        page.appendChild(pageLabel);
        page.appendChild(cardWrapper);

        return page;
    }

    // ==================== ADD NEW PAGE ====================
    function addNewPage(type) {
    const existingPages = document.querySelectorAll('.sq-page-block');
    const pageNumber = existingPages.length + 1;
    const newPageId = `dynamic-page-${pageNumber}-${Date.now()}`;

    const newPage = createPageBlock(type, newPageId);
    // ✅ Mark as dynamic so renderSurvey and updateStepNumbers can target it
    newPage.classList.add('dynamic-page');

    newPage.style.opacity = '0';
    newPage.style.transform = 'translateY(20px)';
    newPage.style.transition = 'opacity 0.3s ease, transform 0.3s ease';

    if (newPagePlaceholder && newPagePlaceholder.parentNode) {
        newPagePlaceholder.parentNode.insertBefore(newPage, newPagePlaceholder);
    } else {
        document.body.appendChild(newPage);
    }

    setTimeout(() => {
        newPage.style.opacity = '1';
        newPage.style.transform = 'translateY(0)';
        updateStepNumbers();
        applyEditModeToPage(newPage, isEditMode);
    }, 10);

    newPage.scrollIntoView({ behavior: 'smooth', block: 'center' });

    const typeNames = { 'multiple-choice': 'Multiple Choice', 'likert': 'Satisfaction/Likert', 'comment': 'Comment' };
    showToast(`${typeNames[type] || type} page added!`, '#2563eb');
}

    // ==================== DATABASE FUNCTIONS (Direct Supabase) ====================

    // ==================== LOAD SURVEY ====================
async function loadLatestSurvey() {
  try {
    const { data: surveys, error } = await db.from('surveys').select('id')
      .order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    if (!surveys?.length) { showToast('No surveys found. Click Edit to create one.', '#6b7280'); return; }
    await loadSurvey(surveys[0].id);
  } catch (err) {
    showToast('Error loading survey: ' + err.message, '#ef4444');
  }
}

async function loadSurvey(surveyId) {
  try {
    showToast('Loading survey...', '#2563eb');
    const cards = [];

    // Fetch all three page types in parallel
    const [mcRes, likertRes, commentRes] = await Promise.all([
      db.from('mc_pages').select('*').eq('survey_id', surveyId).order('page_order'),
      db.from('likert_pages').select('*').eq('survey_id', surveyId).order('page_order'),
      db.from('comment_pages').select('*').eq('survey_id', surveyId).order('page_order'),
    ]);

    if (mcRes.error) throw mcRes.error;
    if (likertRes.error) throw likertRes.error;
    if (commentRes.error) throw commentRes.error;

    // Build a combined sorted array by page_order
    const allPages = [
      ...(mcRes.data || []).map(p => ({ ...p, card_type: 'multiple-choice' })),
      ...(likertRes.data || []).map(p => ({ ...p, card_type: 'likert' })),
      ...(commentRes.data || []).map(p => ({ ...p, card_type: 'comment' })),
    ].sort((a, b) => a.page_order - b.page_order);

    for (const page of allPages) {
      const card = { card_type: page.card_type, instruction: page.instruction, questions: [] };

      if (page.card_type === 'multiple-choice') {
        const { data: qs, error: qErr } = await db.from('mc_questions')
          .select('*').eq('page_id', page.id).order('question_order');
        if (qErr) throw qErr;

        for (const q of qs) {
          const { data: opts, error: oErr } = await db.from('mc_options')
            .select('option_text').eq('question_id', q.id).order('option_order');
          if (oErr) throw oErr;
          card.questions.push({
            question_text: q.question_text,
            select_type: q.select_type,
            options: opts.map(o => o.option_text),
          });
        }

      } else if (page.card_type === 'likert') {
        const { data: qs, error: qErr } = await db.from('likert_questions')
          .select('*').eq('page_id', page.id).order('question_order');
        if (qErr) throw qErr;
        card.questions = qs.map(q => ({ question_text: q.question_text }));

      } else if (page.card_type === 'comment') {
        const { data: qs, error: qErr } = await db.from('comment_questions')
          .select('*').eq('page_id', page.id).order('question_order');
        if (qErr) throw qErr;
        card.questions = qs.map(q => ({ question_text: q.question_text }));
      }

      cards.push(card);
    }

    currentSurveyId = surveyId;
    renderSurvey({ cards });
    showToast('Survey loaded!', '#10b981');

  } catch (err) {
    console.error(err);
    showToast('Error loading survey: ' + err.message, '#ef4444');
  }
}

    function renderSurvey(survey) {
    // ✅ Only remove previously rendered DYNAMIC pages, never touch page1 or page2
    document.querySelectorAll('.sq-page-block.dynamic-page').forEach(p => p.remove());

    if (!survey.cards || survey.cards.length === 0) {
        updateStepNumbers();
        return;
    }

    survey.cards.forEach((card) => {
        const newPage = createPageBlock(card.card_type, `dynamic-page-${Date.now()}-${Math.random()}`);
        // ✅ Mark it so we can target it later without touching static pages
        newPage.classList.add('dynamic-page');

        const instructionTextarea = newPage.querySelector('.card-instruction');
        if (instructionTextarea && card.instruction) instructionTextarea.value = card.instruction;

        const questionsContainer = newPage.querySelector(
            card.card_type === 'multiple-choice' ? '.multiple-choice-questions-container' :
            card.card_type === 'likert' ? '.likert-questions-container' : '.comment-questions-container'
        );

        if (questionsContainer) {
            questionsContainer.innerHTML = '';
            newPage._questionCount = 0;

            card.questions.forEach((question, qIndex) => {
                let questionElement;
                if (card.card_type === 'multiple-choice') {
                    questionElement = createMultipleChoiceQuestion(newPage, qIndex + 1);
                    const qInput = questionElement.querySelector('.mc-question-text');
                    if (qInput) qInput.value = question.question_text || '';
                    const selectType = questionElement.querySelector('.mc-select-type');
                    if (selectType && question.select_type) selectType.value = question.select_type;
                    if (question.options && question.options.length > 0) {
                        const optionsList = questionElement.querySelector('.mc-options-list');
                        if (optionsList) {
                            optionsList.innerHTML = '';
                            question.options.forEach((opt, optIdx) => optionsList.appendChild(createOptionItem(opt, optIdx)));
                        }
                    }
                } else if (card.card_type === 'likert') {
                    questionElement = createLikertQuestion(newPage, qIndex + 1);
                    const qInput = questionElement.querySelector('.likert-question-text');
                    if (qInput) qInput.value = question.question_text || '';
                } else if (card.card_type === 'comment') {
                    questionElement = createCommentQuestion(newPage, qIndex + 1);
                    const qInput = questionElement.querySelector('.comment-question-text');
                    if (qInput) qInput.value = question.question_text || '';
                }
                if (questionElement) questionsContainer.appendChild(questionElement);
                newPage._questionCount = qIndex + 1;
            });
        }

        // ✅ Insert AFTER page2, before the placeholder
        if (newPagePlaceholder && newPagePlaceholder.parentNode) {
            newPagePlaceholder.parentNode.insertBefore(newPage, newPagePlaceholder);
        } else {
            // Fallback: insert after page2
            const page2 = document.getElementById('page2');
            if (page2 && page2.parentNode) {
                page2.parentNode.insertBefore(newPage, page2.nextSibling);
            }
        }
    });

    updateStepNumbers();
    enableAllInputs(false);
    setTimeout(() => { surveySnapshot = extractSurveyState(); }, 0);
}

// ==================== ADD THESE ARCHIVE FUNCTIONS TO survey_question.js ====================
// Place these functions BEFORE the saveSurvey function





// Main archive function
// ==================== ARCHIVE OLD SURVEY QUESTIONS ====================
// Place this BEFORE the saveSurvey() function

// ==================== FULL ARCHIVE: Questions + Responses ====================
// ==================== FULL ARCHIVE: Questions + ALL Survey Responses ====================
async function archiveQuestionsWithResponsesIfNeeded(surveyId) {
  try {
    console.log(`🚀 Starting full archive for survey: ${surveyId}`);

    // Get office_id from survey_responses
    const { data: responseSample } = await db
      .from('survey_responses')
      .select('office_id')
      .eq('survey_id', surveyId)
      .limit(1);

    let officeId = responseSample?.[0]?.office_id ||
                  (typeof currentOfficeId !== 'undefined' ? currentOfficeId : getCurrentOfficeId());

    console.log(`Office ID used: ${officeId}`);

    // Count responses
    const { count: totalResponses } = await db
      .from('survey_responses')
      .select('*', { count: 'exact', head: true })
      .eq('survey_id', surveyId);

    if (!totalResponses || totalResponses === 0) {
      console.log('No responses to archive');
      return false;
    }

    // === Combined Confirmation Modal ===
    const confirmed = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:20000;backdrop-filter:blur(4px);`;

      overlay.innerHTML = `
        <div style="background:#fff;border-radius:20px;max-width:520px;width:90%;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:1.5rem;color:white;">
            <div style="display:flex;align-items:center;gap:0.75rem;">
              <i class="fas fa-archive" style="font-size:1.8rem;"></i>
              <h3 style="margin:0;">Archive Survey?</h3>
            </div>
          </div>
          <div style="padding:1.75rem;">
            <p><strong>This survey has ${totalResponses} existing response(s).</strong></p>
            <p style="margin:12px 0 20px 0; color:#b45309;">
              <strong>Warning:</strong> This will archive the current questions +
              <strong>all responses</strong> (personal info, CC answers, Likert, MC, Comments),
              then delete them from the active tables.
            </p>
            <div style="display:flex;justify-content:flex-end;gap:0.75rem;">
              <button id="cancelArchiveBtn" style="background:#f3f4f6;border:none;padding:0.6rem 1.5rem;border-radius:10px;cursor:pointer;">Cancel</button>
              <button id="confirmArchiveBtn" style="background:#10b981;border:none;padding:0.6rem 1.5rem;border-radius:10px;color:white;cursor:pointer;">Yes, Archive & Clean Up</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);

      overlay.querySelector('#cancelArchiveBtn').onclick = () => { overlay.remove(); resolve(false); };
      overlay.querySelector('#confirmArchiveBtn').onclick = () => { overlay.remove(); resolve(true); };
    });

    if (!confirmed) {
      console.log('❌ User cancelled archiving');
      return null;
    }

    showToast('Creating full archive...', '#f59e0b');

    // 1. Current survey questions + NORMALIZE question_text
    let currentPages = JSON.parse(extractSurveyState());

    // 🔥 FIX: Normalize to use consistent 'question_text' field
    let pagesToArchive = currentPages.map(page => ({
      ...page,
      questions: (page.questions || []).map(q => ({
        ...q,
        question_text: q.question_text || q.text || ''
      }))
    }));

    // 2. Get ALL response data
    const { data: allResponses } = await db
      .from('survey_responses')
      .select('*')
      .eq('survey_id', surveyId);

    const responseIds = allResponses ? allResponses.map(r => r.id) : [];

    // Fetch from the actual answer tables
    const [likertRes, mcRes, commentRes] = await Promise.all([
      responseIds.length ? db.from('likert_responses').select('*').in('response_id', responseIds) : {data: []},
      responseIds.length ? db.from('mc_responses').select('*').in('response_id', responseIds) : {data: []},
      responseIds.length ? db.from('comment_responses').select('*').in('response_id', responseIds) : {data: []},
    ]);

    // 3. Save comprehensive archive
    const { error: archiveError } = await db.from('survey_archives').insert({
      survey_id: surveyId,
      office_id: officeId,
      pages: pagesToArchive,                    // ← Now normalized
      responses: {
        survey_responses: allResponses || [],
        likert_responses: likertRes.data || [],
        mc_responses: mcRes.data || [],
        comment_responses: commentRes.data || []
      },
      total_responses: totalResponses,
      archived_responses_count: totalResponses
    });

    if (archiveError) throw archiveError;

    console.log('✅ Full archive saved successfully');

    // 4. Clean up active responses
    await db.from('survey_responses').delete().eq('survey_id', surveyId);

    await Promise.all([
      db.from('likert_responses').delete().in('response_id', responseIds),
      db.from('mc_responses').delete().in('response_id', responseIds),
      db.from('comment_responses').delete().in('response_id', responseIds)
    ]);

    showToast(`Full archive created successfully! (${totalResponses} responses)`, '#10b981');
    return true;

  } catch (err) {
    console.error('💥 Full archive error:', err);
    showToast('Archive failed: ' + (err.message || err), '#ef4444');
    return null;
  }
}

function getCurrentOfficeId() {
  if (typeof currentOfficeId !== 'undefined' && currentOfficeId) {
    return currentOfficeId;
  }
  const stored = localStorage.getItem('currentOfficeId');
  if (stored) return stored;

  const urlParams = new URLSearchParams(window.location.search);
  const officeParam = urlParams.get('office_id');
  if (officeParam) return officeParam;

  return document.body.dataset.officeId || null;
}

// ==================== UPDATE THE SAVE SURVEY FUNCTION ====================
// Replace your existing saveSurvey function with this one:

async function saveSurvey() {
  const currentState = extractSurveyState();
  if (surveySnapshot !== null && currentState === surveySnapshot) {
    showToast('No changes to save.', '#6b7280');
    exitEditMode();
    return;
  }

  const pageBlocks = document.querySelectorAll('.sq-page-block');
  let hasQuestions = false;

  const mcPages = [], likertPages = [], commentPages = [];
  let pageOrder = 0;

  pageBlocks.forEach((page) => {
    const isMC = !!page.querySelector('.multiple-choice-questions-container');
    const isLikert = !!page.querySelector('.likert-questions-container');
    const isComment = !!page.querySelector('.comment-questions-container');
    if (!isMC && !isLikert && !isComment) return;

    pageOrder++;
    const instruction = page.querySelector('.card-instruction')?.value.trim() || null;

    if (isMC) {
      const questions = [];
      page.querySelectorAll('.mc-question-item').forEach((q, i) => {
        const text = q.querySelector('.mc-question-text')?.value.trim();
        if (!text) return;
        const selectType = q.querySelector('.mc-select-type')?.value || 'radio';
        const options = [...q.querySelectorAll('.mc-option-item input[type="text"]')]
          .map(o => o.value.trim()).filter(Boolean);
        questions.push({ order: i + 1, text, selectType, options });
        hasQuestions = true;
      });
      if (questions.length) mcPages.push({ order: pageOrder, instruction, questions });
    } else if (isLikert) {
      const questions = [];
      page.querySelectorAll('.likert-question-item').forEach((q, i) => {
        const text = q.querySelector('.likert-question-text')?.value.trim();
        if (!text) return;
        questions.push({ order: i + 1, text });
        hasQuestions = true;
      });
      if (questions.length) likertPages.push({ order: pageOrder, instruction, questions });
    } else if (isComment) {
      const questions = [];
      page.querySelectorAll('.comment-question-item').forEach((q, i) => {
        const text = q.querySelector('.comment-question-text')?.value.trim();
        if (!text) return;
        questions.push({ order: i + 1, text });
        hasQuestions = true;
      });
      if (questions.length) commentPages.push({ order: pageOrder, instruction, questions });
    }
  });

  if (!hasQuestions) {
    showToast('Please add at least one question before saving.', '#f59e0b');
    return;
  }

  // ⭐ CHECK FOR EXISTING RESPONSES AND ARCHIVE IF NEEDED ⭐
  if (currentSurveyId) {
    const hadResponses = await archiveQuestionsWithResponsesIfNeeded(currentSurveyId);
    if (hadResponses === null) {
      return; // User cancelled or error
    }
  }

  saveBtn.classList.add('saving');
  saveBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Saving...';

  try {
    let surveyId = currentSurveyId;
    if (surveyId) {
      await db.from('surveys').update({ updated_at: new Date().toISOString() }).eq('id', surveyId);
      await db.from('mc_pages').delete().eq('survey_id', surveyId);
      await db.from('likert_pages').delete().eq('survey_id', surveyId);
      await db.from('comment_pages').delete().eq('survey_id', surveyId);
    } else {
      const { data, error } = await db.from('surveys').insert({}).select().single();
      if (error) throw error;
      surveyId = data.id;
    }

    // Save MC pages
    for (const p of mcPages) {
      const { data: pageRow, error: pErr } = await db.from('mc_pages')
        .insert({ survey_id: surveyId, page_order: p.order, instruction: p.instruction })
        .select().single();
      if (pErr) throw pErr;
      for (const q of p.questions) {
        const { data: qRow, error: qErr } = await db.from('mc_questions')
          .insert({ page_id: pageRow.id, question_order: q.order, question_text: q.text, select_type: q.selectType })
          .select().single();
        if (qErr) throw qErr;
        if (q.options.length) {
          await db.from('mc_options').insert(
            q.options.map((opt, idx) => ({ question_id: qRow.id, option_order: idx + 1, option_text: opt }))
          );
        }
      }
    }

    // Save Likert pages
    for (const p of likertPages) {
      const { data: pageRow, error: pErr } = await db.from('likert_pages')
        .insert({ survey_id: surveyId, page_order: p.order, instruction: p.instruction })
        .select().single();
      if (pErr) throw pErr;
      for (const q of p.questions) {
        await db.from('likert_questions')
          .insert({ page_id: pageRow.id, question_order: q.order, question_text: q.text, scale_points: 5 });
      }
    }

    // Save Comment pages
    for (const p of commentPages) {
      const { data: pageRow, error: pErr } = await db.from('comment_pages')
        .insert({ survey_id: surveyId, page_order: p.order, instruction: p.instruction })
        .select().single();
      if (pErr) throw pErr;
      for (const q of p.questions) {
        await db.from('comment_questions')
          .insert({ page_id: pageRow.id, question_order: q.order, question_text: q.text });
      }
    }

    currentSurveyId = surveyId;
    surveySnapshot = currentState;
    saveBtn.classList.remove('saving');
    saveBtn.classList.add('saved');
    saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved!';
    showToast('Survey saved successfully!', '#10b981');
    setTimeout(() => {
      saveBtn.classList.remove('saved');
      saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Survey';
      exitEditMode();
    }, 1500);

  } catch (err) {
    console.error('Save error:', err);
    saveBtn.classList.remove('saving');
    saveBtn.innerHTML = '<i class="fas fa-save"></i> Save Survey';
    showToast('Error saving: ' + err.message, '#ef4444');
  }
}
    saveBtn.addEventListener('click', saveSurvey);

    // ==================== EDIT MODE CONFIRMATION ====================
    function createEditConfirmationModal() {
        const modalHTML = `
            <div id="editConfirmModal" class="modal-overlay" style="display:none;">
                <div class="modal-content">
                    <h3>Enter Edit Mode?</h3>
                    <p>Do you want to enable editing? This will allow you to add and modify pages.</p>
                    <div class="modal-actions">
                        <button id="modalCancelBtn" class="sq-btn sq-btn-cancel">Cancel</button>
                        <button id="modalConfirmBtn" class="sq-btn sq-btn-confirm">Yes, Continue</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    function showEditConfirmation() {
        let modal = document.getElementById('editConfirmModal');
        if (!modal) { createEditConfirmationModal(); modal = document.getElementById('editConfirmModal'); }
        modal.style.display = 'flex';
        document.getElementById('modalCancelBtn').onclick = () => modal.style.display = 'none';
        document.getElementById('modalConfirmBtn').onclick = () => { modal.style.display = 'none'; enterEditMode(); };
    }

    function enterEditMode() {
    isEditMode = true;
    document.documentElement.classList.add('edit-mode');
    editBtn.style.display = 'none'; // ✅ Hide EDIT button while editing
    addPageBtn.style.display = 'inline-flex';
    saveBtn.style.display = 'inline-flex';
    enableAllInputs(true);
    showToast('Edit mode activated. You can now modify the survey.', '#2563eb');
}

    function exitEditMode() {
    isEditMode = false;
    document.documentElement.classList.remove('edit-mode');
    editBtn.innerHTML = `<i class="fas fa-pen"></i> EDIT`;
    editBtn.classList.remove('sq-btn-done');
    editBtn.classList.add('sq-btn-edit');
    editBtn.style.display = 'inline-flex'; // ✅ Show EDIT button again
    addPageBtn.style.display = 'none';
    saveBtn.style.display = 'none';
    enableAllInputs(false);
}

    // ==================== ADD PAGE MODAL ====================
    function createAddPageModal() {
        const modalHTML = `
            <div id="addPageModal" class="modal-overlay" style="display:none;">
                <div class="modal-content" style="max-width:520px; width:90%;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
                        <h3 style="margin:0; font-size:1.35rem; display:flex; align-items:center; gap:10px;">
                            <i class="fas fa-plus-circle" style="color:#2563eb;"></i> Add New Page
                        </h3>
                        <button id="closeAddPageModal" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#64748b;">×</button>
                    </div>
                    <p style="margin-bottom:20px; color:#334155;">Select the type of questions for this new page:</p>
                    <div class="add-page-options" style="display:flex; flex-direction:column; gap:12px; margin-bottom:28px;">
                        <div class="option-card" data-type="multiple-choice" style="border:2px solid #e2e8f0; border-radius:12px; padding:16px 20px; cursor:pointer; transition:all 0.2s;">
                            <div style="display:flex; align-items:flex-start; gap:16px;">
                                <div style="font-size:1.8rem; color:#2563eb;">📋</div>
                                <div style="flex:1;">
                                    <strong style="font-size:1.1rem;">Multiple Choice</strong>
                                    <p style="margin:4px 0 0 0; color:#64748b; font-size:0.95rem;">Predefined options, single select or checkboxes.</p>
                                </div>
                            </div>
                        </div>
                        <div class="option-card" data-type="likert" style="border:2px solid #e2e8f0; border-radius:12px; padding:16px 20px; cursor:pointer; transition:all 0.2s;">
                            <div style="display:flex; align-items:flex-start; gap:16px;">
                                <div style="font-size:1.8rem; color:#2563eb;">📊</div>
                                <div style="flex:1;">
                                    <strong style="font-size:1.1rem;">Satisfaction / Likert Scale</strong>
                                    <p style="margin:4px 0 0 0; color:#64748b; font-size:0.95rem;">Rating scale from Very Unsatisfied to Very Satisfied.</p>
                                </div>
                            </div>
                        </div>
                        <div class="option-card" data-type="comment" style="border:2px solid #e2e8f0; border-radius:12px; padding:16px 20px; cursor:pointer; transition:all 0.2s;">
                            <div style="display:flex; align-items:flex-start; gap:16px;">
                                <div style="font-size:1.8rem; color:#2563eb;">💬</div>
                                <div style="flex:1;">
                                    <strong style="font-size:1.1rem;">Comment / Open-ended</strong>
                                    <p style="margin:4px 0 0 0; color:#64748b; font-size:0.95rem;">Textarea for long-form feedback.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:12px;">
                        <button id="cancelAddPageBtn" class="sq-btn sq-btn-cancel">Cancel</button>
                        <button id="confirmAddPageBtn" class="sq-btn sq-btn-confirm" disabled>Add Page</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    function openAddPageModal() {
        let modal = document.getElementById('addPageModal');
        if (!modal) {
            createAddPageModal();
            modal = document.getElementById('addPageModal');

            const optionCards = modal.querySelectorAll('.option-card');
            const confirmBtn = document.getElementById('confirmAddPageBtn');

            optionCards.forEach(card => {
                card.addEventListener('mouseenter', () => {
                    if (card.style.borderColor !== 'rgb(37, 99, 235)') {
                        card.style.borderColor = '#93c5fd';
                        card.style.backgroundColor = '#f8fafc';
                        card.style.transform = 'translateY(-2px)';
                    }
                });
                card.addEventListener('mouseleave', () => {
                    if (card.style.borderColor !== 'rgb(37, 99, 235)') {
                        card.style.borderColor = '#e2e8f0';
                        card.style.backgroundColor = '';
                        card.style.transform = 'translateY(0)';
                    }
                });
                card.addEventListener('click', () => {
                    optionCards.forEach(c => { c.style.borderColor = '#e2e8f0'; c.style.backgroundColor = ''; c.style.transform = 'translateY(0)'; });
                    card.style.borderColor = '#2563eb';
                    card.style.backgroundColor = '#f0f9ff';
                    selectedPageType = card.dataset.type;
                    confirmBtn.disabled = false;
                });
            });

            document.getElementById('cancelAddPageBtn').onclick = () => modal.style.display = 'none';
            document.getElementById('closeAddPageModal').onclick = () => modal.style.display = 'none';
            confirmBtn.onclick = () => {
                if (selectedPageType) {
                    addNewPage(selectedPageType);
                    modal.style.display = 'none';
                }
            };
        }

        selectedPageType = null;
        modal.querySelectorAll('.option-card').forEach(c => { c.style.borderColor = '#e2e8f0'; c.style.backgroundColor = ''; c.style.transform = 'translateY(0)'; });
        document.getElementById('confirmAddPageBtn').disabled = true;
        modal.style.display = 'flex';
    }

    // ==================== EVENT LISTENERS ====================
    editBtn.addEventListener('click', () => {
        if (!isEditMode) showEditConfirmation();
        else exitEditMode();
    });

    addPageBtn.addEventListener('click', () => { if (isEditMode) openAddPageModal(); });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay, .custom-modal').forEach(m => {
                if (m.style.display === 'flex') m.style.display = 'none';
            });
        }
    });

    // ==================== INITIAL SETUP ====================
    updateStepNumbers();
    enableAllInputs(false);
    loadLatestSurvey();

    console.log('✅ Survey Question JS — Direct Supabase integration (no backend)');
});