// offices.js
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
  tbody.innerHTML = '';

  const { data, error } = await window.supabaseClient
    .from('offices')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('Load error:', error);
    alert('Failed to load offices: ' + error.message);
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

  row.innerHTML = `
    <td style="padding: 16px 20px;">${photoHtml}</td>
    <td style="padding: 16px 20px; font-weight: 500;">${office.name}</td>
    <td style="padding: 16px 20px; text-align: center;">
      <button onclick="editOffice('${office.id}')" style="background:none;border:none;color:#3b82f6;margin-right:10px;">
        <i class="fas fa-edit"></i>
      </button>
      <button onclick="deleteOffice('${office.id}')" style="background:none;border:none;color:#ef4444;">
        <i class="fas fa-trash"></i>
      </button>
    </td>
  `;
  return row;
}

function addNewOffice() {
  editingId = null;
  document.getElementById('modalTitle').textContent = 'Add New Office';
  document.getElementById('officeForm').reset();
  resetPhotoEditor();
  document.getElementById('officeModal').style.display = 'flex';
}

async function saveOffice(e) {
  e.preventDefault();

  const name = document.getElementById('officeName').value.trim();
  if (!name) return alert("Office name is required!");

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
      alert('Photo upload failed: ' + uploadError.message);
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
    alert('Save failed: ' + result.error.message);
  } else {
    closeModal();
    loadOffices();
  }
}

async function editOffice(id) {
  editingId = id;
  resetPhotoEditor();

  const { data, error } = await window.supabaseClient
    .from('offices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return alert('Failed to load office');

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
  if (!confirm('Delete this office?')) return;

  const { error } = await window.supabaseClient
    .from('offices')
    .delete()
    .eq('id', id);

  if (error) alert('Delete failed');
  else loadOffices();
}

function closeModal() {
  document.getElementById('officeModal').style.display = 'none';
  editingId = null;
}

function updateEmptyState() {
  const tbody = document.getElementById('officesTable');
  document.getElementById('emptyState').style.display =
    (tbody.children.length === 0) ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', () => {
  loadOffices();
  initPhotoDrag();

  document.getElementById('officeModal').addEventListener('click', (e) => {
    if (e.target.id === 'officeModal') closeModal();
  });
});