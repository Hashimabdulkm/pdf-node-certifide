// Generates a complete, self-contained HTML string for a vehicle inspection PDF.
// All CSS is inlined — no CDN, no external stylesheets — so Puppeteer renders
// correctly offline or with restricted network access.

export function generateInspectionHtml(payload) {
  const {
    inspection = {},
    vehicle_info = {},
    inspector = null,
    approver = null,
    formatted_sections = [],
    rating = 0,
    main_images = {},
    summary_images = [],
  } = payload;

  const escHtml = (str) =>
    String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const fmt = (v) => (v ? escHtml(v) : '<span class="na">N/A</span>');

  const fmtDate = (iso) => {
    if (!iso) return '<span class="na">N/A</span>';
    try {
      return new Date(iso).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return escHtml(iso);
    }
  };

  const isApproved = !!inspection.is_approved;

  // ─── STATUS COLOR GRADIENTS (mirrors the Blade template) ─────────────────
  const STATUS_GRADIENTS = {
    'dark-green':   'linear-gradient(135deg,#11734b,#0e5c3c)',
    'light-green':  'linear-gradient(135deg,#d4edbc,#c3e4a1)',
    'green':        'linear-gradient(135deg,#d4edbc,#c3e4a1)',
    'yellow':       'linear-gradient(135deg,#ffbb00,#ffd980)',
    'dark-yellow':  'linear-gradient(135deg,#FFC8AA,#ffb088)',
    'light-yellow': 'linear-gradient(135deg,#FFE5A0,#ffd980)',
    'red':          'linear-gradient(135deg,#db0a0a,#d01515)',
    'light-red':    'linear-gradient(135deg,#ff6666,#ff4d4d)',
    'common-color': 'linear-gradient(135deg,#4b5563,#374151)',
  };

  const STATUS_TEXT_COLORS = {
    'light-green': '#333',
    'green':       '#333',
    'yellow':      '#333',
    'dark-yellow': '#333',
    'light-yellow':'#333',
  };

  const badgeStyle = (colorName) => {
    const gradient  = STATUS_GRADIENTS[colorName] || STATUS_GRADIENTS['common-color'];
    const textColor = STATUS_TEXT_COLORS[colorName] || '#fff';
    return `background:${gradient};color:${textColor};`;
  };

  // ─── MAIN IMAGES ─────────────────────────────────────────────────────────
  const mainImagePositions = [
    { key: 'front_view', label: 'Front View' },
    { key: 'back_view',  label: 'Rear View'  },
    { key: 'left_view',  label: 'Left View'  },
    { key: 'right_view', label: 'Right View' },
  ];

  const mainImagesHtml = mainImagePositions.map(({ key, label }) => {
    const url = main_images[key];
    return url
      ? `<div class="main-img-cell">
           <img src="${escHtml(url)}" alt="${label}" class="main-img" loading="eager"/>
           <div class="main-img-label">${label}</div>
         </div>`
      : `<div class="main-img-cell placeholder">
           <div class="img-placeholder-icon">&#9651;</div>
           <div class="main-img-label">${label}</div>
         </div>`;
  }).join('');

  // ─── VEHICLE SPEC CHIPS ──────────────────────────────────────────────────
  const specChips = [
    vehicle_info.manufacturing_year,
    vehicle_info.fuel_type,
    vehicle_info.transmission,
    vehicle_info.color,
    vehicle_info.variant,
    vehicle_info.odometer ? `${vehicle_info.odometer} km` : null,
  ]
    .filter(Boolean)
    .map((v) => `<span class="spec-chip">${escHtml(v)}</span>`)
    .join('');

  // ─── INSPECTION SECTIONS ─────────────────────────────────────────────────
  const sectionsHtml = formatted_sections
    .map((section) => {
      if (!section.items || section.items.length === 0) return '';

      const itemsHtml = section.items
        .map((item) => {
          const hasImage =
            item.imageUrl ||
            (item.multiImages && item.multiImages.length > 0);
          const cardClass = hasImage ? 'field-card field-card--wide' : 'field-card';

          const singleImg = item.imageUrl
            ? `<div class="field-img-wrap">
                 <img src="${escHtml(item.imageUrl)}" class="field-img" alt="${escHtml(item.title)}" loading="eager"/>
               </div>`
            : '';

          const multiImgs =
            !item.imageUrl && item.multiImages && item.multiImages.length > 0
              ? `<div class="multi-img-strip">${item.multiImages
                  .slice(0, 4)
                  .map(
                    (u) =>
                      `<img src="${escHtml(u)}" class="multi-img" alt="" loading="eager"/>`
                  )
                  .join('')}</div>`
              : '';

          const remarksHtml = item.remarks
            ? `<div class="field-remarks">${escHtml(item.remarks)}</div>`
            : '';

          const scoreHtml =
            item.score !== null && item.score !== undefined
              ? `<span class="field-score">${Number(item.score).toFixed(1)}</span>`
              : '';

          const colorN = item.colorName || 'common-color';
          const cssCol  = item.cssColor  || '#374151';
          const bStyle  = badgeStyle(colorN);

          return `<div class="${cardClass}">
            <div class="field-header">
              <span class="field-dot" style="background:${escHtml(cssCol)}"></span>
              <span class="field-title">${escHtml(item.title)}</span>
              ${scoreHtml}
            </div>
            <div class="field-badge" style="${bStyle}">${escHtml(item.value ?? 'N/A')}</div>
            ${singleImg}${multiImgs}${remarksHtml}
          </div>`;
        })
        .join('');

      const iconHtml = section.icon
        ? `<span class="section-icon">${escHtml(section.icon)}</span>`
        : '';

      return `<div class="section-block">
        <div class="section-title">${iconHtml}${escHtml(section.title || section.section_key || '')}</div>
        <div class="fields-grid">${itemsHtml}</div>
      </div>`;
    })
    .join('');

  // ─── SUMMARY IMAGES ───────────────────────────────────────────────────────
  const summaryImagesHtml =
    summary_images.length > 0
      ? `<div class="summary-images-section">
          <div class="section-title">Summary Images</div>
          <div class="summary-grid">${summary_images
            .filter((img) => img.url)
            .map(
              (img) =>
                `<div class="summary-img-cell">
                   <img src="${escHtml(img.url)}" class="summary-img" alt="Summary" loading="eager"/>
                 </div>`
            )
            .join('')}</div>
        </div>`
      : '';

  // ─── SCORE RING ───────────────────────────────────────────────────────────
  const ratingNum   = parseFloat(rating) || 0;
  const ratingPct   = Math.round((ratingNum / 5) * 100);
  const ratingColor = ratingNum >= 4 ? '#166534' : ratingNum >= 3 ? '#ca8a04' : '#991b1b';

  const scoreSectionHtml = `<div class="score-section">
    <div class="score-ring" style="--pct:${ratingPct};--clr:${ratingColor}">
      <div class="score-inner">
        <span class="score-value">${ratingNum.toFixed(1)}</span>
        <span class="score-sub">/ 5</span>
      </div>
    </div>
    <div class="score-label-block">
      <div class="score-heading">Overall Inspection Score</div>
      <div class="score-bar-wrap">
        <div class="score-bar" style="width:${ratingPct}%;background:${ratingColor}"></div>
      </div>
      <div class="score-pct">${ratingPct}% &mdash; ${
        ratingNum >= 4.5 ? 'Excellent' :
        ratingNum >= 4   ? 'Very Good' :
        ratingNum >= 3   ? 'Good' :
        ratingNum >= 2   ? 'Fair' : 'Poor'
      }</div>
    </div>
  </div>`;

  // ─── APPROVAL / PENDING BLOCK ─────────────────────────────────────────────
  const approvalHtml = isApproved
    ? `<div class="approval-block">
        <div class="approval-icon">&#10003;</div>
        <div class="approval-details">
          <div class="approval-title">Inspection Approved</div>
          <div class="approval-meta">
            <span>By: <strong>${fmt(approver?.name ?? 'Admin')}</strong></span>
            <span>On: <strong>${fmtDate(inspection.approved_at)}</strong></span>
          </div>
          ${inspection.approval_remarks
            ? `<div class="approval-remarks">&ldquo;${escHtml(inspection.approval_remarks)}&rdquo;</div>`
            : ''}
        </div>
      </div>`
    : `<div class="pending-block">
        <div class="pending-dot"></div>
        <span>Pending Approval</span>
      </div>`;

  // ─── FULL HTML DOCUMENT ───────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Certifide &ndash; Vehicle Inspection Report</title>
<style>
/* ===================================================================
   RESET & PAGE
   =================================================================== */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
@page { size: A4; margin: 10mm; }
html, body {
  font-family: Arial, "Segoe UI", Helvetica, sans-serif;
  font-size: 11px;
  color: #111827;
  background: #fff;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ===================================================================
   REPORT HEADER
   =================================================================== */
.report-header {
  background: linear-gradient(135deg, #0046ad 0%, #003580 100%);
  color: #fff;
  padding: 14px 18px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-radius: 6px 6px 0 0;
  page-break-inside: avoid;
}
.brand-block { display: flex; align-items: center; gap: 12px; }
.brand-logo-box {
  width: 42px; height: 42px;
  background: rgba(255,255,255,0.15);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 900; letter-spacing: -1px;
  border: 1px solid rgba(255,255,255,0.3);
}
.brand-name { font-size: 22px; font-weight: 900; letter-spacing: 3px; line-height: 1; }
.brand-tagline { font-size: 8px; letter-spacing: 2px; opacity: 0.7; margin-top: 3px; text-transform: uppercase; }
.header-right { text-align: right; }
.report-title { font-size: 13px; font-weight: 700; letter-spacing: 0.5px; opacity: 0.95; }
.report-ref   { font-size: 10px; opacity: 0.75; margin: 3px 0 5px; }
.status-pill {
  display: inline-block;
  padding: 3px 12px;
  border-radius: 20px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
}
.status-pill--approved { background: #22c55e; color: #fff; }
.status-pill--pending  { background: #f59e0b; color: #fff; }

/* ===================================================================
   MAIN VEHICLE IMAGES (2 × 2 grid)
   =================================================================== */
.main-images-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  background: #1e293b;
  padding: 4px;
  border-left: 4px solid #0046ad;
  border-right: 4px solid #0046ad;
}
.main-img-cell {
  position: relative;
  background: #e5e7eb;
  border-radius: 3px;
  overflow: hidden;
  height: 135px;
  display: flex;
  flex-direction: column;
}
.main-img {
  width: 100%;
  flex: 1;
  object-fit: cover;
  display: block;
}
.main-img-label {
  text-align: center;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  padding: 3px 4px;
  background: rgba(0,0,0,0.55);
  letter-spacing: 0.5px;
}
.placeholder {
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #9ca3af;
  font-size: 9px;
}
.img-placeholder-icon { font-size: 26px; opacity: 0.3; }

/* ===================================================================
   VEHICLE INFO BAR
   =================================================================== */
.vehicle-info-bar {
  background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
  border: 1px solid #cbd5e1;
  border-top: 3px solid #0046ad;
  padding: 12px 16px 10px;
  border-radius: 0 0 6px 6px;
  margin-bottom: 8px;
}
.vehicle-make-model {
  font-size: 17px;
  font-weight: 900;
  color: #0f172a;
  letter-spacing: 0.3px;
  line-height: 1.2;
}
.vehicle-reg {
  font-size: 12px;
  color: #0046ad;
  font-weight: 700;
  font-family: "Courier New", monospace;
  margin: 3px 0 7px;
  letter-spacing: 1px;
}
.spec-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.spec-chip {
  background: #0046ad;
  color: #fff;
  font-size: 8.5px;
  font-weight: 700;
  padding: 3px 9px;
  border-radius: 20px;
  letter-spacing: 0.3px;
}

/* ===================================================================
   INFO CARDS ROW (inspector / date / odometer)
   =================================================================== */
.info-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  margin-bottom: 10px;
}
.info-card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-top: 2px solid #0046ad;
  border-radius: 5px;
  padding: 8px 10px;
}
.info-card-label {
  font-size: 8.5px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  font-weight: 700;
}
.info-card-value {
  font-size: 11px;
  color: #111827;
  font-weight: 700;
  margin-top: 3px;
  line-height: 1.3;
}
.info-card-sub {
  font-size: 9px;
  color: #6b7280;
  margin-top: 1px;
}

/* ===================================================================
   INSPECTION SECTIONS
   =================================================================== */
.section-block {
  margin: 10px 0;
  page-break-inside: avoid;
}
.section-title {
  font-size: 11px;
  font-weight: 900;
  color: #0046ad;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  border-bottom: 2px solid #0046ad;
  padding-bottom: 4px;
  margin-bottom: 7px;
  display: flex;
  align-items: center;
  gap: 6px;
}
.section-icon { font-size: 12px; }

/* ===================================================================
   FIELDS GRID
   =================================================================== */
.fields-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}
.field-card {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 5px;
  padding: 7px 8px;
  page-break-inside: avoid;
}
.field-card--wide { grid-column: span 2; }
.field-header {
  display: flex;
  align-items: flex-start;
  gap: 5px;
  margin-bottom: 4px;
}
.field-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-top: 1px;
}
.field-title {
  font-size: 9px;
  color: #374151;
  font-weight: 600;
  flex: 1;
  line-height: 1.3;
}
.field-score {
  font-size: 9px;
  color: #0046ad;
  font-weight: 800;
  flex-shrink: 0;
  background: #eff6ff;
  padding: 1px 5px;
  border-radius: 4px;
}
.field-badge {
  display: inline-block;
  padding: 2px 9px;
  border-radius: 20px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.2px;
  margin-bottom: 5px;
  max-width: 100%;
  word-break: break-word;
}
.field-img-wrap {
  margin-top: 5px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid #e5e7eb;
}
.field-img {
  width: 100%;
  max-height: 110px;
  object-fit: cover;
  display: block;
}
.multi-img-strip {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 3px;
  margin-top: 5px;
}
.multi-img {
  width: 100%;
  height: 58px;
  object-fit: cover;
  border-radius: 3px;
  display: block;
}
.field-remarks {
  font-size: 8.5px;
  color: #6b7280;
  font-style: italic;
  margin-top: 5px;
  line-height: 1.5;
  padding-top: 4px;
  border-top: 1px dashed #e5e7eb;
}
.na { color: #9ca3af; font-style: italic; }

/* ===================================================================
   SUMMARY IMAGES
   =================================================================== */
.summary-images-section { margin: 10px 0; }
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
  margin-top: 6px;
}
.summary-img-cell {
  border-radius: 5px;
  overflow: hidden;
  height: 100px;
  border: 1px solid #e5e7eb;
}
.summary-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* ===================================================================
   OVERALL SCORE
   =================================================================== */
.score-section {
  display: flex;
  align-items: center;
  gap: 18px;
  background: linear-gradient(135deg, #f8fafc, #e6f0ff);
  border: 1px solid #c7d7f5;
  border-left: 4px solid #0046ad;
  border-radius: 8px;
  padding: 14px 18px;
  margin: 12px 0;
  page-break-inside: avoid;
}
.score-ring {
  position: relative;
  width: 70px;
  height: 70px;
  border-radius: 50%;
  background: conic-gradient(var(--clr) calc(var(--pct) * 1%), #e2e8f0 0%);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.score-ring::before {
  content: '';
  position: absolute;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: #fff;
}
.score-inner {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}
.score-value { font-size: 17px; font-weight: 900; color: #0f172a; }
.score-sub   { font-size: 7px;  color: #94a3b8; margin-top: 1px; }
.score-label-block { flex: 1; }
.score-heading {
  font-size: 13px;
  font-weight: 800;
  color: #0046ad;
  margin-bottom: 6px;
}
.score-bar-wrap {
  background: #e2e8f0;
  border-radius: 20px;
  height: 8px;
  overflow: hidden;
  margin-bottom: 5px;
}
.score-bar {
  height: 100%;
  border-radius: 20px;
  transition: width 0s;
}
.score-pct { font-size: 10px; color: #374151; font-weight: 600; }

/* ===================================================================
   APPROVAL / PENDING
   =================================================================== */
.approval-block {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  background: linear-gradient(135deg, #f0fdf4, #dcfce7);
  border: 1px solid #86efac;
  border-left: 4px solid #22c55e;
  border-radius: 8px;
  padding: 12px 14px;
  margin: 10px 0;
  page-break-inside: avoid;
}
.approval-icon {
  width: 32px; height: 32px;
  background: #22c55e;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: #fff; font-weight: 900;
  flex-shrink: 0;
}
.approval-title { font-size: 12px; font-weight: 800; color: #15803d; margin-bottom: 4px; }
.approval-meta  { display: flex; gap: 18px; font-size: 10px; color: #374151; flex-wrap: wrap; }
.approval-remarks {
  font-size: 10px;
  color: #374151;
  margin-top: 6px;
  font-style: italic;
  padding: 5px 8px;
  background: rgba(255,255,255,0.6);
  border-radius: 4px;
}
.pending-block {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fffbeb;
  border: 1px solid #fcd34d;
  border-left: 4px solid #f59e0b;
  border-radius: 8px;
  padding: 10px 14px;
  margin: 10px 0;
  font-size: 11px;
  font-weight: 700;
  color: #92400e;
}
.pending-dot {
  width: 10px; height: 10px;
  background: #f59e0b;
  border-radius: 50%;
  flex-shrink: 0;
}

/* ===================================================================
   DISCLAIMER
   =================================================================== */
.disclaimer {
  margin: 14px 0 8px;
  padding: 10px 14px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  page-break-inside: avoid;
}
.disclaimer-title {
  font-size: 10px;
  font-weight: 800;
  color: #1e293b;
  margin-bottom: 5px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
}
.disclaimer-text {
  font-size: 9px;
  line-height: 1.7;
  color: #64748b;
  text-align: justify;
}

/* ===================================================================
   FOOTER
   =================================================================== */
.report-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px;
  border-top: 1px solid #e2e8f0;
  margin-top: 8px;
  font-size: 9px;
  color: #9ca3af;
}
.footer-brand { font-weight: 700; color: #0046ad; }

/* ===================================================================
   PRINT OVERRIDES
   =================================================================== */
@media print {
  .section-block, .field-card, .score-section, .approval-block { page-break-inside: avoid; }
}
</style>
</head>
<body>
<div class="page">

  <!-- ════════════════════════════════════════
       HEADER
       ════════════════════════════════════════ -->
  <div class="report-header">
    <div class="brand-block">
      <div class="brand-logo-box">C</div>
      <div>
        <div class="brand-name">CERTIFIDE</div>
        <div class="brand-tagline">Vehicle Intelligence Platform</div>
      </div>
    </div>
    <div class="header-right">
      <div class="report-title">Vehicle Inspection Report</div>
      <div class="report-ref">Ref&nbsp;No:&nbsp;${fmt(inspection.reference_number)}</div>
      <span class="status-pill ${isApproved ? 'status-pill--approved' : 'status-pill--pending'}">
        ${isApproved ? '&#10003; Approved' : '&#9679; Pending'}
      </span>
    </div>
  </div>

  <!-- ════════════════════════════════════════
       MAIN VEHICLE IMAGES
       ════════════════════════════════════════ -->
  <div class="main-images-grid">${mainImagesHtml}</div>

  <!-- ════════════════════════════════════════
       VEHICLE INFO BAR
       ════════════════════════════════════════ -->
  <div class="vehicle-info-bar">
    <div class="vehicle-make-model">${fmt(vehicle_info.make_model)}</div>
    <div class="vehicle-reg">${fmt(vehicle_info.registration_number)}</div>
    <div class="spec-chips">${specChips || '<span class="na">No specs available</span>'}</div>
  </div>

  <!-- ════════════════════════════════════════
       INFO CARDS  (Inspector / Date / Odo)
       ════════════════════════════════════════ -->
  <div class="info-cards">
    <div class="info-card">
      <div class="info-card-label">Inspector</div>
      <div class="info-card-value">${fmt(inspector?.name)}</div>
      ${inspector?.email ? `<div class="info-card-sub">${escHtml(inspector.email)}</div>` : ''}
    </div>
    <div class="info-card">
      <div class="info-card-label">Inspection Date</div>
      <div class="info-card-value">${fmtDate(inspection.created_at)}</div>
    </div>
    <div class="info-card">
      <div class="info-card-label">Odometer Reading</div>
      <div class="info-card-value">
        ${vehicle_info.odometer
          ? `${escHtml(vehicle_info.odometer)}&nbsp;km`
          : '<span class="na">N/A</span>'}
      </div>
    </div>
  </div>

  <!-- ════════════════════════════════════════
       INSPECTION SECTIONS
       ════════════════════════════════════════ -->
  ${sectionsHtml}

  <!-- ════════════════════════════════════════
       SUMMARY IMAGES
       ════════════════════════════════════════ -->
  ${summaryImagesHtml}

  <!-- ════════════════════════════════════════
       OVERALL SCORE
       ════════════════════════════════════════ -->
  ${scoreSectionHtml}

  <!-- ════════════════════════════════════════
       APPROVAL STATUS
       ════════════════════════════════════════ -->
  ${approvalHtml}

  <!-- ════════════════════════════════════════
       DISCLAIMER
       ════════════════════════════════════════ -->
  <div class="disclaimer">
    <div class="disclaimer-title">Disclaimer</div>
    <div class="disclaimer-text">
      This inspection report has been prepared by Certifide based on a visual and functional assessment of
      the vehicle at the time of inspection. The findings reflect the condition of the vehicle as observed
      and do not constitute a guarantee or warranty of any kind. Certifide shall not be held liable for any
      latent defects, mechanical failures, or issues not apparent during the inspection. This report is
      intended solely for informational purposes and should not be construed as legal or financial advice.
      Vehicle condition may change after the date of inspection.
    </div>
  </div>

  <!-- ════════════════════════════════════════
       FOOTER
       ════════════════════════════════════════ -->
  <div class="report-footer">
    <span><span class="footer-brand">CERTIFIDE</span> &mdash; Vehicle Intelligence Platform</span>
    <span>certifide.in</span>
    <span>Generated&nbsp;${fmtDate(inspection.created_at)}</span>
  </div>

</div>
</body>
</html>`;
}
