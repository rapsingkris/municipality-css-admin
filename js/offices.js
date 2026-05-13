// ============================================
// 🔐 ROLE HIERARCHY SYSTEM
// super_admin > admin > viewer
// ============================================
let currentUserRole = null;
let currentUserId = null;

const ROLE_RANK = {
  super_admin: 3,
  admin: 2,
  viewer: 1
};

const ROLE_PERMISSIONS = {
  super_admin: {
    canEditOffices: true,
    canDeleteOffices: true,
    canAddOffices: true,
    rank: 3
  },
  admin: {
    canEditOffices: true,
    canDeleteOffices: true,
    canAddOffices: true,
    rank: 2
  },
  viewer: {
    canEditOffices: false,
    canDeleteOffices: false,
    canAddOffices: false,
    rank: 1
  }
};

async function checkUserRole() {
  const supabaseUrl = 'https://ircbidpdgkezxnszzeuu.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY2JpZHBkZ2tlenhuc3p6ZXV1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MjQ1ODYsImV4cCI6MjA5MjIwMDU4Nn0.OkLuJsyIx1a3AsIb9w7KWEDlyIJfWjQJ9O_fN5KoSMw';
  const sb = supabase.createClient(supabaseUrl, supabaseKey);

  const { data: { session } } = await sb.auth.getSession();
  if (!session) return 'viewer';

  currentUserId = session.user.id;

  const { data: adminData } = await sb.from('admin_users').select('role').eq('id', session.user.id).single();
  return adminData?.role || 'viewer';
}

function hasPermission(action) {
  if (!currentUserRole) return false;
  const permissions = ROLE_PERMISSIONS[currentUserRole];
  return permissions && permissions[action] === true;
}

// Custom modal alert instead of browser alert
function showAlert(message, type = 'warning') {
  // Remove existing alert modal if any
  const existingModal = document.getElementById('customAlertModal');
  if (existingModal) existingModal.remove();

  const modal = document.createElement('div');
  modal.id = 'customAlertModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;

  const icon = type === 'warning' ? '⚠️' : type === 'error' ? '❌' : 'ℹ️';
  const color = type === 'warning' ? 'var(--accent-blue)' : type === 'error' ? '#dc2626' : '#3b82f6';

  modal.innerHTML = `
    <div style="background: white; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
      <div style="font-size: 48px; margin-bottom: 16px;">${icon}</div>
      <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1e293b;">Access Denied</h3>
      <p style="font-size: 14px; color: #475569; margin-bottom: 24px; line-height: 1.5;">${message}</p>
      <button onclick="this.closest('#customAlertModal').remove()" style="background: ${color}; color: white; border: none; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">
        OK
      </button>
    </div>
  `;

  document.body.appendChild(modal);

  // Close on click outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// ============================================
// END OF ROLE CHECK
// ============================================

let editingId = null;

// ── Photo Editor State ──────────────────────────────────────────
let photoState = {
  file: null,
  existingUrl: null,
  dragStartX: 0,
  dragStartY: 0,
  offsetX: 0,
  offsetY: 0,
  tempX: 0,
  tempY: 0,
  scale: 1,
  naturalW: 0,
  naturalH: 0,
};

function handlePhotoSelect(event) {
  if (!hasPermission('canEditOffices')) {
    showAlert('Viewers cannot edit office photos. Please contact an administrator.', 'warning');
    return;
  }

  const file = event.target.files[0];
  if (!file) return;

  photoState.file = file;
  photoState.existingUrl = null;
  photoState.offsetX = 0;
  photoState.offsetY = 0;
  photoState.scale = 1;

  const reader = new FileReader();
  reader.onload = (e) => {
    const img = document.getElementById('photoPreview');
    img.onload = () => {
      photoState.naturalW = img.naturalWidth;
      photoState.naturalH = img.naturalHeight;

      const frameSize = 140;
      const fitScale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight);
      photoState.scale = fitScale;
      document.getElementById('zoomSlider').value = fitScale;
      document.getElementById('zoomSlider').min = fitScale * 0.5;

      photoState.offsetX = (frameSize - img.naturalWidth * fitScale) / 2;
      photoState.offsetY = (frameSize - img.naturalHeight * fitScale) / 2;

      applyTransform();
    };
    img.src = e.target.result;

    document.getElementById('photoUploadTrigger').style.display = 'none';
    document.getElementById('photoEditorWrap').style.display = 'flex';
  };
  reader.readAsDataURL(file);
}

function applyTransform() {
  photoState.scale = parseFloat(document.getElementById('zoomSlider').value);
  const img = document.getElementById('photoPreview');
  img.style.transform = `translate(${photoState.offsetX}px, ${photoState.offsetY}px) scale(${photoState.scale})`;
}

function resetPhotoEditor() {
  photoState = { file: null, existingUrl: null, dragStartX: 0, dragStartY: 0, offsetX: 0, offsetY: 0, tempX: 0, tempY: 0, scale: 1, naturalW: 0, naturalH: 0 };
  document.getElementById('officePhoto').value = '';
  document.getElementById('photoPreview').src = '';
  document.getElementById('photoEditorWrap').style.display = 'none';
  document.getElementById('photoUploadTrigger').style.display = 'block';
}

function initPhotoDrag() {
  const frame = document.getElementById('cropFrame');
  if (!frame) return;

  frame.addEventListener('mousedown', (e) => {
    e.preventDefault();
    photoState.dragStartX = e.clientX - photoState.offsetX;
    photoState.dragStartY = e.clientY - photoState.offsetY;
    frame.style.cursor = 'grabbing';

    const onMove = (ev) => {
      photoState.offsetX = ev.clientX - photoState.dragStartX;
      photoState.offsetY = ev.clientY - photoState.dragStartY;
      applyTransform();
    };
    const onUp = () => {
      frame.style.cursor = 'grab';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  frame.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    photoState.dragStartX = t.clientX - photoState.offsetX;
    photoState.dragStartY = t.clientY - photoState.offsetY;

    const onMove = (ev) => {
      const touch = ev.touches[0];
      photoState.offsetX = touch.clientX - photoState.dragStartX;
      photoState.offsetY = touch.clientY - photoState.dragStartY;
      applyTransform();
    };
    const onEnd = () => {
      frame.removeEventListener('touchmove', onMove);
      frame.removeEventListener('touchend', onEnd);
    };
    frame.addEventListener('touchmove', onMove, { passive: true });
    frame.addEventListener('touchend', onEnd);
  });
}

function getCroppedBlob() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    const size = 140;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);

    const img = document.getElementById('photoPreview');
    ctx.save();
    ctx.translate(photoState.offsetX, photoState.offsetY);
    ctx.scale(photoState.scale, photoState.scale);
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);
    ctx.restore();

    canvas.toBlob(resolve, 'image/jpeg', 0.92);
  });
}

async function loadOffices() {
  const tbody = document.getElementById('officesTable');
  if (!tbody) return;
  tbody.innerHTML = '';

  const { data, error } = await window.supabaseClient
    .from('offices')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Load error:', error);
    return;
  }

  if (data?.length > 0) {
    data.forEach(office => tbody.appendChild(createTableRow(office)));
  }
  updateEmptyState();
}

function createTableRow(office) {
  const row = document.createElement('tr');
  row.style.borderBottom = '1px solid #f1f3f9';
  row.dataset.id = office.id;

  const photoHtml = office.photo_url
    ? `<img src="${office.photo_url}" alt="${office.name}" style="width:50px;height:50px;object-fit:cover;border-radius:8px;background:#ffffff;display:block;">`
    : `<div style="width:50px;height:50px;background:#e2e8f0;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:1.5rem;">📁</div>`;

  const canEdit = hasPermission('canEditOffices');

  const isViewer = !canEdit;
const editDisabledAttr = isViewer ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : '';
const deleteDisabledAttr = isViewer ? 'disabled style="opacity:0.5;cursor:not-allowed;"' : '';

row.innerHTML = `
    <td style="padding: 16px 20px;">${photoHtml}</td>
    <td style="padding: 16px 20px; font-weight: 500;">${escapeHtml(office.name)}</td>
    <td style="padding: 16px 20px; text-align: center; white-space: nowrap;">
      <button onclick="editOffice('${office.id}')" ${editDisabledAttr} class="action-btn edit-btn" style="display: inline-flex; margin: 0 4px;">
        <i class="fas fa-edit"></i>
      </button>
      <button onclick="deleteOffice('${office.id}')" ${deleteDisabledAttr} class="action-btn delete-btn" style="display: inline-flex; margin: 0 4px;">
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;
  return row;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function addNewOffice() {
  if (!hasPermission('canAddOffices')) {
    showAlert('Your account does not have permission to add offices. Only Super Admins and Admins can add offices.', 'warning');
    return;
  }

  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add New Office';
  document.getElementById('officeForm').reset();
  resetPhotoEditor();
  document.getElementById('officeModal').style.display = 'flex';
}

async function saveOffice(e) {
  e.preventDefault();

  if (!hasPermission('canAddOffices') && !hasPermission('canEditOffices')) {
    showAlert('Your account does not have permission to save offices.', 'warning');
    return;
  }

  const name = document.getElementById('officeName').value.trim();
  if (!name) {
    showAlert('Office name is required!', 'warning');
    return;
  }

  let photo_url = photoState.existingUrl || null;

  if (photoState.file) {
    const croppedBlob = await getCroppedBlob();
    const fileExt = photoState.file.name.split('.').pop();
    const fileName = `office_${Date.now()}.${fileExt}`;

    const { error: uploadError } = await window.supabaseClient.storage
      .from('office-photos')
      .upload(fileName, croppedBlob, { upsert: true, contentType: photoState.file.type });

    if (uploadError) {
      console.error(uploadError);
      showAlert('Photo upload failed: ' + uploadError.message, 'error');
      return;
    }

    const { data: urlData } = window.supabaseClient.storage
      .from('office-photos')
      .getPublicUrl(fileName);
    photo_url = urlData.publicUrl;
  }

  const officeData = { name, photo_url };

  let result;
  if (editingId) {
    result = await window.supabaseClient.from('offices').update(officeData).eq('id', editingId);
  } else {
    result = await window.supabaseClient.from('offices').insert(officeData);
  }

  if (result.error) {
    console.error(result.error);
    showAlert('Save failed: ' + result.error.message, 'error');
  } else {
    closeModal();
    loadOffices();
  }
}

async function editOffice(id) {
  if (!hasPermission('canEditOffices')) {
    showAlert('Your account does not have permission to edit offices. Only Super Admins and Admins can edit offices.', 'warning');
    return;
  }

  editingId = id;
  resetPhotoEditor();

  const { data, error } = await window.supabaseClient
    .from('offices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    showAlert('Failed to load office', 'error');
    return;
  }

  document.getElementById('modalTitle').textContent = 'Edit Office';
  document.getElementById('officeName').value = data.name || '';

  if (data.photo_url) {
    const img = document.getElementById('photoPreview');

    img.onload = () => {
      photoState.naturalW = img.naturalWidth;
      photoState.naturalH = img.naturalHeight;

      const frameSize = 140;
      const fitScale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight);
      photoState.scale = fitScale;

      const slider = document.getElementById('zoomSlider');
      slider.value = fitScale;
      slider.min = fitScale * 0.5;

      photoState.offsetX = (frameSize - img.naturalWidth * fitScale) / 2;
      photoState.offsetY = (frameSize - img.naturalHeight * fitScale) / 2;

      applyTransform();
    };

    img.crossOrigin = 'anonymous';
    img.src = data.photo_url;

    document.getElementById('photoUploadTrigger').style.display = 'none';
    document.getElementById('photoEditorWrap').style.display = 'flex';

    photoState.existingUrl = data.photo_url;
  }

  document.getElementById('officeModal').style.display = 'flex';
}

async function deleteOffice(id) {
  if (!hasPermission('canDeleteOffices')) {
    showAlert('Your account does not have permission to delete offices. Only Super Admins and Admins can delete offices.', 'warning');
    return;
  }

  // Create custom confirm modal
  const confirmModal = document.createElement('div');
  confirmModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
  `;

  confirmModal.innerHTML = `
    <div style="background: white; border-radius: 16px; padding: 24px; max-width: 400px; width: 90%; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.2);">
      <div style="font-size: 48px; margin-bottom: 16px;">🗑️</div>
      <h3 style="font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #1e293b;">Confirm Delete</h3>
      <p style="font-size: 14px; color: #475569; margin-bottom: 24px; line-height: 1.5;">Are you sure you want to delete this office? This action cannot be undone.</p>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="confirmDeleteBtn" style="background: #dc2626; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">Delete</button>
        <button id="cancelDeleteBtn" style="background: #e2e8f0; color: #475569; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer;">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(confirmModal);

  document.getElementById('confirmDeleteBtn').onclick = async () => {
    confirmModal.remove();
    const { error } = await window.supabaseClient
      .from('offices')
      .delete()
      .eq('id', id);

    if (error) {
      showAlert('Delete failed: ' + error.message, 'error');
    } else {
      loadOffices();
    }
  };

  document.getElementById('cancelDeleteBtn').onclick = () => {
    confirmModal.remove();
  };

  confirmModal.addEventListener('click', (e) => {
    if (e.target === confirmModal) confirmModal.remove();
  });
}

function closeModal() {
  document.getElementById('officeModal').style.display = 'none';
  editingId = null;
}

function updateEmptyState() {
  const tbody = document.getElementById('officesTable');
  const emptyState = document.getElementById('emptyState');
  if (emptyState) {
    emptyState.style.display = (tbody.children.length === 0) ? 'block' : 'none';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // First, check user role
  currentUserRole = await checkUserRole();
  console.log('User role:', currentUserRole);

  // Load offices
  await loadOffices();
  initPhotoDrag();

  const modal = document.getElementById('officeModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'officeModal') closeModal();
    });
  }
});