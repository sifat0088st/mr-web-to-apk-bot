const state = {
  workerUrl: localStorage.getItem('mr_worker_url') || window.location.origin,
  token: localStorage.getItem('mr_admin_token') || '',
  lang: localStorage.getItem('mr_dash_lang') || 'en',
  modalHandler: null,
};

const I18N = {
  en: {
    authSubtitle: 'Cloudflare Workers + Linux Docker APK Builder Admin',
    workerUrlLabel: 'Cloudflare Worker URL',
    username: 'Username',
    password: 'Password',
    totpOptional: '2FA TOTP Code (if enabled)',
    signIn: 'Sign In to Dashboard',
    firstTimeBootstrap: 'First-time Super Admin Setup',
    bootstrapTitle: 'Bootstrap Super Admin',
    logout: 'Logout',
    tabOverview: 'Overview',
    tabUsers: 'Users & Wallets',
    tabBuilds: 'Builds & Queue',
    tabChannels: 'Join & Earn',
    tabSettings: 'Settings & Limits',
    tabAdmins: 'Admins & Roles',
    tabAudit: 'Audit & Security',
    overviewTitle: 'Platform Overview',
    refresh: 'Refresh',
    buildServerHealth: 'External Build Server Health',
    usersTitle: 'Users & Reward Accounting',
    buildsTitle: 'Build Queue & History',
    channelsTitle: 'Join & Earn Channels / Groups',
    settingsTitle: 'System, Referral & Upload Limits',
    adminsTitle: 'Admin Accounts & RBAC',
    auditTitle: 'Immutable Audit & Security Logs',
  },
  bn: {
    authSubtitle: 'ক্লাউডফ্লেয়ার ওয়ার্কার্স + লিনাক্স ডকার APK বিল্ডার অ্যাডমিন',
    workerUrlLabel: 'ক্লাউডফ্লেয়ার ওয়ার্কার URL',
    username: 'ইউজারনেম',
    password: 'পাসওয়ার্ড',
    totpOptional: '2FA TOTP কোড (চালু থাকলে)',
    signIn: 'ড্যাশবোর্ডে সাইন ইন করুন',
    firstTimeBootstrap: 'প্রথমবার সুপার অ্যাডমিন সেটআপ',
    bootstrapTitle: 'সুপার অ্যাডমিন তৈরি করুন',
    logout: 'লগআউট',
    tabOverview: 'ওভারভিউ',
    tabUsers: 'ইউজার ও ওয়ালেট',
    tabBuilds: 'বিল্ড ও কিউ',
    tabChannels: 'জয়েন ও আয় চ্যানেল',
    tabSettings: 'সেটিংস ও লিমিট',
    tabAdmins: 'অ্যাডমিন ও রোল',
    tabAudit: 'অডিট ও সিকিউরিটি লগ',
    overviewTitle: 'প্ল্যাটফর্ম পরিসংখ্যান',
    refresh: 'রিফ্রেশ',
    buildServerHealth: 'এক্সটার্নাল বিল্ড সার্ভার স্ট্যাটাস',
    usersTitle: 'ইউজার ও পয়েন্ট লেজার',
    buildsTitle: 'বিল্ড কিউ এবং ইতিহাস',
    channelsTitle: 'জয়েন অ্যান্ড আর্ন চ্যানেল / গ্রুপ',
    settingsTitle: 'সিস্টেম, রেফারেল এবং আপলোড লিমিট',
    adminsTitle: 'অ্যাডমিন অ্যাকাউন্ট ও অনুমতি',
    auditTitle: 'অপরিবর্তনীয় অডিট ও সিকিউরিটি লগ',
  },
};

function applyLang() {
  const dict = I18N[state.lang] || I18N.en;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (dict[key]) el.textContent = dict[key];
  });
}

function toast(msg, type = 'success') {
  const box = document.getElementById('toast-container');
  const div = document.createElement('div');
  div.className = `toast ${type}`;
  div.textContent = msg;
  box.appendChild(div);
  setTimeout(() => div.remove(), 4000);
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path, options = {}) {
  const base = state.workerUrl.replace(/\/$/, '');
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const resp = await fetch(`${base}${path}`, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (resp.status === 401 && state.token) {
    state.token = '';
    localStorage.removeItem('mr_admin_token');
    showAuth();
  }
  if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
  return data;
}

function showAuth() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app-shell').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  loadStats();
}

async function loadStats() {
  try {
    const s = await api('/api/admin/stats');
    const items = [
      ['Total Users', s.totalUsers],
      ['Active Users (7d)', s.activeUsers],
      ['Total ZIP Uploads', s.totalZipUploads],
      ['Successful Builds', s.successfulBuilds],
      ['Failed Builds', s.failedBuilds],
      ['Rejected ZIPs', s.rejectedZipUploads],
      ['Current Build Queue', s.currentBuildQueue],
      ['Points Issued', Number(s.pointsIssued).toLocaleString()],
      ['Free Credits Issued', s.freeApkCreditsIssued],
      ['Qualified Referrals', `${s.qualifiedReferrals} / ${s.totalReferrals}`],
      ['Join & Earn Rewards', s.telegramMembershipRewards],
      ['Maintenance Mode', s.maintenanceMode ? 'ON' : 'OFF'],
    ];
    document.getElementById('stats-grid').innerHTML = items
      .map(([k, v]) => `<div class="stat-card"><div class="stat-label">${escapeHtml(k)}</div><div class="stat-value">${escapeHtml(v)}</div></div>`)
      .join('');

    const h = s.buildServerHealth || {};
    const pill = document.getElementById('server-pill');
    const online = h.status === 'online';
    pill.textContent = online ? `Builder: Online (${h.activeJobs ?? 0} active)` : 'Builder: Offline / Waiting';
    pill.className = `pill ${online ? 'pill-green' : 'pill-amber'}`;

    document.getElementById('build-server-card').innerHTML = `
      <div><div class="stat-label">Status</div><strong>${escapeHtml(h.status || 'unknown')}</strong></div>
      <div><div class="stat-label">CPU Load (1m)</div><strong>${escapeHtml(h.cpuLoad1m ?? '-')}</strong></div>
      <div><div class="stat-label">RAM Free / Total</div><strong>${escapeHtml(h.ramFreeMb ?? '-')} / ${escapeHtml(h.ramTotalMb ?? '-')} MB</strong></div>
      <div><div class="stat-label">Disk Free</div><strong>${escapeHtml(h.diskFreeGb ?? '-')} GB</strong></div>
      <div><div class="stat-label">Docker Ready</div><strong>${h.dockerReady ? 'Yes' : 'No'}</strong></div>
    `;
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadUsers(q = '') {
  try {
    const data = await api(`/api/admin/users?q=${encodeURIComponent(q)}`);
    document.getElementById('users-tbody').innerHTML = data.users
      .map(
        (u) => `
        <tr>
          <td>#${u.id}<br><span class="muted">${u.telegram_user_id}</span></td>
          <td>${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}<br><span class="muted">@${escapeHtml(u.username || '-')}</span></td>
          <td><strong>${Number(u.points_balance).toLocaleString()}</strong></td>
          <td><strong>${u.free_apk_credits}</strong></td>
          <td><span class="pill ${u.is_banned ? 'pill-red' : 'pill-green'}">${u.is_banned ? 'Banned' : 'Active'}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="openAdjustPoints(${u.id}, '${escapeHtml(u.first_name)}')">± Points</button>
            <button class="btn btn-outline btn-sm" onclick="openAdjustCredits(${u.id}, '${escapeHtml(u.first_name)}')">± Credits</button>
            <button class="btn ${u.is_banned ? 'btn-primary' : 'btn-danger'} btn-sm" onclick="openBanModal(${u.id}, ${u.is_banned ? 'false' : 'true'})">${u.is_banned ? 'Unban' : 'Ban'}</button>
          </td>
        </tr>`
      )
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadBuilds(status = '') {
  try {
    const data = await api(`/api/admin/builds?status=${encodeURIComponent(status)}`);
    document.getElementById('builds-tbody').innerHTML = data.builds
      .map((b) => {
        const pillClass = b.status === 'completed' ? 'pill-green' : b.status === 'failed' ? 'pill-red' : 'pill-amber';
        return `
        <tr>
          <td><code>${escapeHtml(b.job_code)}</code></td>
          <td><strong>${escapeHtml(b.app_name)}</strong><br><span class="muted">${escapeHtml(b.package_name)}</span></td>
          <td>${b.telegram_user_id}</td>
          <td>${escapeHtml(b.stage)} (${b.progress_percent}%)</td>
          <td><span class="pill ${pillClass}">${escapeHtml(b.status)}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="viewBuildLogs(${b.id}, '${escapeHtml(b.job_code)}')">Logs</button>
            ${b.status === 'failed' ? `<button class="btn btn-primary btn-sm" onclick="retryBuild(${b.id})">Retry</button>` : ''}
            ${b.status === 'queued' || b.status === 'processing' ? `<button class="btn btn-danger btn-sm" onclick="cancelBuild(${b.id})">Cancel</button>` : ''}
          </td>
        </tr>`;
      })
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadChannels() {
  try {
    const data = await api('/api/admin/channels');
    document.getElementById('channels-tbody').innerHTML = data.channels
      .map(
        (c) => `
        <tr>
          <td><strong>${escapeHtml(c.name)}</strong><br><a href="${escapeHtml(c.invite_url)}" target="_blank">${escapeHtml(c.invite_url)}</a></td>
          <td><code>${escapeHtml(c.chat_id)}</code></td>
          <td>${c.reward_points} pts</td>
          <td><span class="pill ${c.is_active ? 'pill-green' : 'pill-gray'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <button class="btn btn-outline btn-sm" onclick="toggleChannel(${c.id}, ${c.is_active ? 'false' : 'true'})">${c.is_active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-danger btn-sm" onclick="deleteChannel(${c.id})">Delete</button>
          </td>
        </tr>`
      )
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadSettings() {
  try {
    const data = await api('/api/admin/settings');
    document.getElementById('settings-form').innerHTML = data.settings
      .filter((s) => !s.key.startsWith('build_server_'))
      .map(
        (s) => `
        <div class="form-group">
          <label for="set-${escapeHtml(s.key)}">${escapeHtml(s.key)}</label>
          <input id="set-${escapeHtml(s.key)}" data-setting-key="${escapeHtml(s.key)}" value="${escapeHtml(s.value)}" />
          <div class="muted">${escapeHtml(s.description)}</div>
        </div>`
      )
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadAdmins() {
  try {
    const data = await api('/api/admin/admins');
    document.getElementById('admins-tbody').innerHTML = data.admins
      .map(
        (a) => `
        <tr>
          <td><strong>${escapeHtml(a.username)}</strong></td>
          <td>${escapeHtml(a.role)}</td>
          <td>${a.totp_enabled ? 'Enabled ✅' : 'Off'}</td>
          <td>${escapeHtml(a.last_login_at || 'Never')}</td>
        </tr>`
      )
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function loadAuditLogs() {
  try {
    const data = await api('/api/admin/audit-logs');
    document.getElementById('audit-tbody').innerHTML = data.logs
      .map(
        (l) => `
        <tr>
          <td>${escapeHtml(l.created_at)}</td>
          <td>${escapeHtml(l.actor_type)}:${escapeHtml(l.actor_id)}</td>
          <td><code>${escapeHtml(l.action)}</code></td>
          <td>${escapeHtml(l.target_type)}:${escapeHtml(l.target_id)}</td>
          <td>${escapeHtml(l.reason)}</td>
        </tr>`
      )
      .join('');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function openModal({ title, subtitle, showDelta, deltaLabel, onSubmit }) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-subtitle').textContent = subtitle;
  document.getElementById('modal-delta-group').classList.toggle('hidden', !showDelta);
  document.getElementById('modal-delta-label').textContent = deltaLabel || 'Amount';
  document.getElementById('modal-delta').value = '';
  document.getElementById('modal-reason').value = '';
  state.modalHandler = onSubmit;
  document.getElementById('action-modal').classList.remove('hidden');
}

window.openAdjustPoints = (userId, name) => {
  openModal({
    title: `Adjust Points — ${name}`,
    subtitle: 'Generates an immutable point_transactions ledger entry + audit log.',
    showDelta: true,
    deltaLabel: 'Points Delta (e.g., 500 or -250)',
    onSubmit: async (delta, reason) => {
      await api(`/api/admin/users/${userId}/adjust-points`, { method: 'POST', body: JSON.stringify({ delta: Number(delta), reason }) });
      toast('Points adjusted');
      loadUsers(document.getElementById('user-search-input').value);
    },
  });
};

window.openAdjustCredits = (userId, name) => {
  openModal({
    title: `Adjust Free APK Credits — ${name}`,
    subtitle: 'Generates an immutable free_apk_credits ledger entry + audit log.',
    showDelta: true,
    deltaLabel: 'Credits Delta (e.g., 1 or -1)',
    onSubmit: async (delta, reason) => {
      await api(`/api/admin/users/${userId}/adjust-credits`, { method: 'POST', body: JSON.stringify({ delta: Number(delta), reason }) });
      toast('Free APK credits updated');
      loadUsers(document.getElementById('user-search-input').value);
    },
  });
};

window.openBanModal = (userId, isBanned) => {
  openModal({
    title: isBanned ? 'Ban User' : 'Unban User',
    subtitle: 'Recorded in immutable audit_logs.',
    showDelta: false,
    onSubmit: async (_delta, reason) => {
      await api(`/api/admin/users/${userId}/ban`, { method: 'POST', body: JSON.stringify({ isBanned, reason }) });
      toast(isBanned ? 'User banned' : 'User unbanned');
      loadUsers(document.getElementById('user-search-input').value);
    },
  });
};

window.viewBuildLogs = async (jobId, jobCode) => {
  try {
    const data = await api(`/api/admin/builds/${jobId}/logs`);
    document.getElementById('build-logs-title').textContent = `Logs — ${jobCode}`;
    document.getElementById('build-logs-pre').textContent = data.logs
      .map((l) => `[${l.created_at}] [${l.level.toUpperCase()}] [${l.stage}] ${l.message}`)
      .join('\n');
    document.getElementById('build-logs-card').classList.remove('hidden');
  } catch (e) {
    toast(e.message, 'error');
  }
};

window.retryBuild = async (jobId) => {
  try {
    await api(`/api/admin/builds/${jobId}/retry`, { method: 'POST' });
    toast('Build re-queued');
    loadBuilds(document.getElementById('build-status-filter').value);
  } catch (e) {
    toast(e.message, 'error');
  }
};

window.cancelBuild = async (jobId) => {
  try {
    await api(`/api/admin/builds/${jobId}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled via Admin Dashboard' }) });
    toast('Build cancelled & refunded');
    loadBuilds(document.getElementById('build-status-filter').value);
  } catch (e) {
    toast(e.message, 'error');
  }
};

window.toggleChannel = async (id, isActive) => {
  try {
    await api(`/api/admin/channels/${id}`, { method: 'PATCH', body: JSON.stringify({ isActive }) });
    loadChannels();
  } catch (e) {
    toast(e.message, 'error');
  }
};

window.deleteChannel = async (id) => {
  try {
    await api(`/api/admin/channels/${id}`, { method: 'DELETE' });
    loadChannels();
  } catch (e) {
    toast(e.message, 'error');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('worker-url').value = state.workerUrl;
  applyLang();

  if (state.token) showApp();
  else showAuth();

  document.getElementById('toggle-bootstrap-btn').onclick = () => {
    document.getElementById('bootstrap-form').classList.toggle('hidden');
  };

  document.getElementById('auth-lang-btn').onclick = document.getElementById('lang-toggle-btn').onclick = () => {
    state.lang = state.lang === 'en' ? 'bn' : 'en';
    localStorage.setItem('mr_dash_lang', state.lang);
    applyLang();
  };

  document.getElementById('login-form').onsubmit = async (e) => {
    e.preventDefault();
    state.workerUrl = document.getElementById('worker-url').value.trim();
    localStorage.setItem('mr_worker_url', state.workerUrl);
    try {
      const data = await api('/api/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('login-username').value.trim(),
          password: document.getElementById('login-password').value,
          totpCode: document.getElementById('login-totp').value.trim() || undefined,
        }),
      });
      state.token = data.token;
      localStorage.setItem('mr_admin_token', state.token);
      toast('Welcome back!');
      showApp();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('bootstrap-form').onsubmit = async (e) => {
    e.preventDefault();
    state.workerUrl = document.getElementById('worker-url').value.trim();
    localStorage.setItem('mr_worker_url', state.workerUrl);
    try {
      const data = await api('/api/admin/auth/bootstrap', {
        method: 'POST',
        body: JSON.stringify({
          bootstrapSecret: document.getElementById('boot-secret').value,
          username: document.getElementById('boot-username').value.trim(),
          password: document.getElementById('boot-password').value,
          enableTotp: document.getElementById('boot-totp').checked,
        }),
      });
      toast(`Super Admin created! ${data.totpSecret ? `TOTP Secret: ${data.totpSecret}` : ''}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('logout-btn').onclick = () => {
    state.token = '';
    localStorage.removeItem('mr_admin_token');
    showAuth();
  };

  document.getElementById('mobile-menu-btn').onclick = () => {
    document.getElementById('sidebar').classList.toggle('open');
  };

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      document.getElementById(`tab-${tab}`).classList.add('active');
      document.getElementById('sidebar').classList.remove('open');
      if (tab === 'overview') loadStats();
      if (tab === 'users') loadUsers();
      if (tab === 'builds') loadBuilds();
      if (tab === 'channels') loadChannels();
      if (tab === 'settings') loadSettings();
      if (tab === 'admins') loadAdmins();
      if (tab === 'audit') loadAuditLogs();
    };
  });

  document.getElementById('refresh-stats-btn').onclick = loadStats;
  document.getElementById('user-search-btn').onclick = () => loadUsers(document.getElementById('user-search-input').value);
  document.getElementById('refresh-builds-btn').onclick = () => loadBuilds(document.getElementById('build-status-filter').value);
  document.getElementById('close-logs-btn').onclick = () => document.getElementById('build-logs-card').classList.add('hidden');
  document.getElementById('refresh-audit-btn').onclick = loadAuditLogs;

  document.getElementById('add-channel-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/channels', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('ch-name').value.trim(),
          username: document.getElementById('ch-username').value.trim(),
          chatId: document.getElementById('ch-chat-id').value.trim(),
          inviteUrl: document.getElementById('ch-url').value.trim(),
          rewardPoints: Number(document.getElementById('ch-reward').value),
        }),
      });
      e.target.reset();
      toast('Channel added');
      loadChannels();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('save-settings-btn').onclick = async () => {
    const updates = {};
    document.querySelectorAll('[data-setting-key]').forEach((input) => {
      updates[input.dataset.settingKey] = input.value;
    });
    try {
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ updates, reason: 'Saved via Admin Dashboard' }) });
      toast('Settings saved');
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('setup-webhook-btn').onclick = async () => {
    try {
      const res = await api('/api/admin/telegram/setup-webhook', { method: 'POST' });
      toast(`Webhook registered: ${res.webhookUrl}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('create-admin-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await api('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('new-admin-user').value.trim(),
          password: document.getElementById('new-admin-pass').value,
          roleId: Number(document.getElementById('new-admin-role').value),
          enableTotp: document.getElementById('new-admin-totp').checked,
        }),
      });
      e.target.reset();
      toast(`Admin created! ${res.totpSecret ? `TOTP Secret: ${res.totpSecret}` : ''}`);
      loadAdmins();
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  document.getElementById('modal-cancel').onclick = () => document.getElementById('action-modal').classList.add('hidden');
  document.getElementById('modal-form').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await state.modalHandler(document.getElementById('modal-delta').value, document.getElementById('modal-reason').value);
      document.getElementById('action-modal').classList.add('hidden');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
});
