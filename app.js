const STORAGE_KEYS = {
  wrongs: "toeic_vocab_wrongs_v2",
  wrongsLegacy: "toeic_vocab_wrongs_v1",
  known: "toeic_vocab_known_v2",
  knownLegacy: "toeic_vocab_known_v1",
  themeChoice: "toeic_vocab_theme_choice_v1"
};

const state = {
  data: [],
  byId: new Map(),
  days: [],
  selectedDays: new Set(),
  search: "",
  sort: "day",
  tab: "home",
  page: 1,
  pageSize: 30,
  viewOrderSeed: 1,
  filteredCacheKey: "",
  filteredCache: [],
  wrongs: loadJson(STORAGE_KEYS.wrongs, loadJson(STORAGE_KEYS.wrongsLegacy, {})),
  known: new Set(loadJson(STORAGE_KEYS.known, loadJson(STORAGE_KEYS.knownLegacy, []))),
  flash: {
    order: [],
    index: 0,
    reveal: false,
  },
  quiz: {
    mode: "multiple",
    direction: "engToKor",
    source: "current",
    count: 20,
    queue: [],
    pointer: 0,
    correct: 0,
    wrong: 0,
    current: null,
    choices: [],
    answered: false,
    lastFeedback: "",
    userAnswer: "",
  },
  voices: [],
  preferredVoices: {
    us: null,
    uk: null,
  },
};

const els = {};
let deferredInstallPrompt = null;
let searchDebounce = null;

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveWrongs() {
  localStorage.setItem(STORAGE_KEYS.wrongs, JSON.stringify(state.wrongs));
}

function saveKnown() {
  localStorage.setItem(STORAGE_KEYS.known, JSON.stringify([...state.known]));
}

function saveThemeChoice(choice) {
  localStorage.setItem(STORAGE_KEYS.themeChoice, choice);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripPos(text) {
  return String(text || "")
    .replace(/(^|\n)\s*([A-Za-z]{1,5}\.)\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function displayMeaning(item) {
  return String(item?.meaning || stripPos(item?.meaningRaw || "") || "").trim();
}

function displayCategory(item) {
  return String(item?.category || "").trim();
}

function normKo(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\[\]\(\)\{\}]/g, "")
    .replace(/[.,/#!$%^&*;:{}=_`~?·…'"“”‘’<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normEn(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[\[\]\(\)\{\}]/g, "")
    .replace(/[.,/#!$%^&*;:{}=_`~?·…'"“”‘’<>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function formatDateTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("ko-KR");
  } catch {
    return String(value);
  }
}

function getEnglishVariants(word) {
  const set = new Set();
  const raw = String(word || "").trim();
  if (!raw) return [];
  set.add(normEn(raw));
  set.add(normEn(raw.replace(/\([^)]*\)/g, " ")));
  set.add(normEn(raw.replace(/[()]/g, "")));
  raw.split(/[;/]/).forEach((part) => set.add(normEn(part)));
  if (/\([^)]*\)/.test(raw)) set.add(normEn(raw.replace(/\(([^)]*)\)/g, "$1")));
  return [...set].filter(Boolean);
}

function isCorrectSubjective(userInput, item, direction) {
  if (!userInput.trim()) return false;
  if (direction === "korToEng") {
    const input = normEn(userInput);
    return getEnglishVariants(item.word).some((v) => v === input);
  }
  const input = normKo(userInput);
  const answer = displayMeaning(item);
  const full = normKo(answer);
  if (full.includes(input)) return true;
  const tokens = answer.split(/[\n,;/]/).map((t) => normKo(t)).filter(Boolean);
  return tokens.some((token) => token === input || token.includes(input) || input.includes(token));
}

function buildDataIndexes(data) {
  state.data = data.map((item) => ({
    ...item,
    meaning: String(item.meaning || stripPos(item.meaningRaw || "")).trim(),
    _searchWord: String(item.word || "").toLowerCase(),
    _searchMeaning: String(item.meaning || item.meaningRaw || "").toLowerCase(),
    _searchCategory: String(item.category || "").toLowerCase(),
  }));
  state.byId = new Map(state.data.map((item) => [item.id, item]));
  state.days = [...new Set(state.data.map((item) => item.day))].sort((a, b) => a - b);
  state.selectedDays = new Set();
  invalidateFilteredCache();
}

function invalidateFilteredCache() {
  state.filteredCacheKey = "";
}

function describeSelectedDays() {
  const days = [...state.selectedDays].sort((a, b) => a - b);
  if (!days.length) return "없음";
  if (days.length === 1) return `Day ${days[0]}`;
  if (days.length === state.days.length) return `전체 ${days.length}일`;
  return `Day ${days[0]} ~ Day ${days[days.length - 1]} 외 ${days.length}일`;
}

function hasSelection() {
  return state.selectedDays.size > 0;
}

function setDrawerOpen(open) {
  const drawer = document.getElementById("controlDrawer");
  const backdrop = document.getElementById("drawerBackdrop");
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  backdrop.classList.toggle("hidden", !open);
  document.body.style.overflow = open ? "hidden" : "";
}

function selectDays(days) {
  state.selectedDays = new Set(days);
  state.page = 1;
  invalidateFilteredCache();
  resetFlashOrder();
  updateDayGridSelection();
  renderStats();
  renderHome();
  renderActiveTab();
}

function renderSelectionPrompt(title, description) {
  return `
    <div class="empty-state picker-empty">
      <strong>${escapeHtml(title)}</strong>
      <p class="subtext">${escapeHtml(description)}</p>
      <div class="action-bar wrap center">
        <button class="btn primary" type="button" data-selection-preset="day1">Day 1 선택</button>
        <button class="btn" type="button" data-selection-preset="all">전체 DAY 선택</button>
        <button class="btn" type="button" data-selection-preset="menu">메뉴 열기</button>
      </div>
    </div>`;
}

function renderHome() {
  if (els.homeTotalWords) els.homeTotalWords.textContent = state.data.length ? state.data.length.toLocaleString() : "-";
  if (els.homeSelectedDays) els.homeSelectedDays.textContent = describeSelectedDays();
}

function getSelectedWords() {
  const dayKey = [...state.selectedDays].sort((a, b) => a - b).join(",");
  const cacheKey = [dayKey, state.search, state.sort, state.viewOrderSeed].join("|");
  if (cacheKey === state.filteredCacheKey) return state.filteredCache;

  let list = state.data.filter((item) => state.selectedDays.has(item.day));

  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((item) => item._searchWord.includes(q) || item._searchMeaning.includes(q) || item._searchCategory.includes(q));
  }

  if (state.sort === "alpha") {
    list = [...list].sort((a, b) => a.word.localeCompare(b.word));
  } else if (state.sort === "korean") {
    list = [...list].sort((a, b) => displayMeaning(a).localeCompare(displayMeaning(b), "ko"));
  } else if (state.sort === "random") {
    list = [...list].sort((a, b) => hashCode(`${a.id}|${state.viewOrderSeed}`) - hashCode(`${b.id}|${state.viewOrderSeed}`));
  } else {
    list = [...list].sort((a, b) => a.day - b.day || a.seq - b.seq);
  }

  state.filteredCache = list;
  state.filteredCacheKey = cacheKey;
  return list;
}

function getWrongItems() {
  const wrongIds = new Set(Object.keys(state.wrongs));
  return state.data
    .filter((item) => wrongIds.has(item.id))
    .sort((a, b) => {
      const wa = state.wrongs[a.id] || {};
      const wb = state.wrongs[b.id] || {};
      return (wb.count || 0) - (wa.count || 0) || String(wb.lastWrong || "").localeCompare(String(wa.lastWrong || ""));
    });
}

function addWrong(item, extra = {}) {
  const prev = state.wrongs[item.id] || { count: 0 };
  state.wrongs[item.id] = {
    count: (prev.count || 0) + 1,
    lastWrong: new Date().toISOString(),
    word: item.word,
    meaningRaw: displayMeaning(item),
    day: item.day,
    category: item.category,
    ...extra,
  };
  saveWrongs();
  renderStats();
  if (state.tab === "wrong") renderWrongTab();
}

function removeWrong(itemId) {
  delete state.wrongs[itemId];
  saveWrongs();
  renderStats();
  if (state.tab === "wrong") renderWrongTab();
}

function toggleKnown(itemId) {
  if (state.known.has(itemId)) state.known.delete(itemId);
  else state.known.add(itemId);
  saveKnown();
  renderStats();
  renderActiveTab();
}

function initElements() {
  const ids = [
    "searchInput", "dayGrid", "sortSelect", "pageSizeSelect", "totalWordsStat", "selectedWordsStat", "wrongCountStat", "knownCountStat",
    "listSummary", "wordList", "pageInfo", "flashSummary", "flashcard", "quizCard", "quizModeSelect", "quizDirectionSelect",
    "quizSourceSelect", "quizCountSelect", "quizProgressStat", "quizCorrectStat", "quizWrongStat", "wrongSummary", "wrongList",
    "loadingPanel", "installAppBtn", "installStatus", "homeTotalWords", "homeSelectedDays", "ttsStatus"
  ];
  ids.forEach((id) => { els[id] = document.getElementById(id); });
}

function renderDayGrid() {
  els.dayGrid.innerHTML = state.days.map((day) => {
    const active = state.selectedDays.has(day) ? "active" : "";
    return `<button class="chip ${active}" data-day="${day}" type="button">Day ${day}</button>`;
  }).join("");
}

function updateDayGridSelection() {
  els.dayGrid.querySelectorAll("[data-day]").forEach((btn) => {
    btn.classList.toggle("active", state.selectedDays.has(Number(btn.dataset.day)));
  });
}

function renderStats() {
  const selected = getSelectedWords();
  els.totalWordsStat.textContent = state.data.length.toLocaleString();
  els.selectedWordsStat.textContent = selected.length.toLocaleString();
  els.knownCountStat.textContent = state.known.size.toLocaleString();
  els.wrongCountStat.textContent = Object.keys(state.wrongs).length.toLocaleString();
  renderHome();
}

function buildWordCard(item) {
  const known = state.known.has(item.id);
  const wrong = state.wrongs[item.id];
  return `
    <article class="word-card">
      <div class="word-card-top">
        <div class="word-meta">
          <span class="meta-pill">Day ${item.day}</span>
          ${displayCategory(item) ? `<span class="meta-pill">${escapeHtml(displayCategory(item))}</span>` : ""}
          ${known ? '<span class="meta-pill">암기됨</span>' : ''}
          ${wrong ? `<span class="meta-pill">오답 ${wrong.count || 1}회</span>` : ''}
        </div>
      </div>
      <div class="word-main">
        <h4>${escapeHtml(item.word)}</h4>
        <div class="meaning-cell">${escapeHtml(displayMeaning(item))}</div>
      </div>
      <div class="table-actions">
        <button class="icon-btn" data-action="speak-us" data-id="${item.id}" type="button">US</button>
        <button class="icon-btn" data-action="speak-uk" data-id="${item.id}" type="button">UK</button>
        <button class="icon-btn" data-action="known" data-id="${item.id}" type="button">암기</button>
        <button class="icon-btn" data-action="wrong" data-id="${item.id}" type="button">오답</button>
      </div>
    </article>`;
}

function renderListTab() {
  const list = getSelectedWords();
  if (!hasSelection()) {
    els.listSummary.textContent = "DAY를 선택하면 단어장을 불러옵니다.";
    els.pageInfo.textContent = "-";
    els.wordList.innerHTML = renderSelectionPrompt("먼저 DAY를 골라 주세요.", "오른쪽 위 메뉴에서 원하는 DAY를 체크하면 그때부터 단어장이 표시됩니다.");
    return;
  }
  const totalPages = Math.max(1, Math.ceil(list.length / state.pageSize));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * state.pageSize;
  const pageItems = list.slice(start, start + state.pageSize);
  els.listSummary.textContent = `현재 범위 ${list.length.toLocaleString()}개 · 페이지당 ${state.pageSize}개`;
  els.pageInfo.textContent = `${state.page} / ${totalPages} 페이지`;

  if (!pageItems.length) {
    els.wordList.innerHTML = `<div class="empty">조건에 맞는 단어가 없습니다.</div>`;
    return;
  }

  els.wordList.innerHTML = pageItems.map(buildWordCard).join("");
}

function resetFlashOrder() {
  state.flash.order = getSelectedWords().map((item) => item.id);
  state.flash.index = 0;
  state.flash.reveal = false;
}

function currentFlashItem() {
  const id = state.flash.order[state.flash.index];
  return id ? state.byId.get(id) : null;
}

function renderFlashcard() {
  const list = getSelectedWords();
  if (!hasSelection()) {
    els.flashSummary.textContent = "DAY를 선택하면 암기 카드를 시작할 수 있습니다.";
    els.flashcard.innerHTML = renderSelectionPrompt("암기 카드 범위를 먼저 골라 주세요.", "오른쪽 위 메뉴에서 DAY를 체크하거나 Day 1부터 바로 시작할 수 있습니다.");
    return;
  }
  if (!state.flash.order.length) resetFlashOrder();
  const item = currentFlashItem();
  els.flashSummary.textContent = `현재 범위 ${list.length.toLocaleString()}개 · ${Math.min(state.flash.index + 1, Math.max(1, state.flash.order.length))}/${Math.max(1, state.flash.order.length)}`;
  if (!item) {
    els.flashcard.innerHTML = `<div class="empty-state">표시할 카드가 없습니다.</div>`;
    return;
  }
  const known = state.known.has(item.id);
  const wrong = !!state.wrongs[item.id];
  els.flashcard.innerHTML = `
    <div class="wrong-meta">
      <span class="meta-pill">Day ${item.day}</span>
      ${displayCategory(item) ? `<span class="meta-pill">${escapeHtml(displayCategory(item))}</span>` : ""}
      ${known ? '<span class="meta-pill">암기됨</span>' : ''}
      ${wrong ? '<span class="meta-pill">오답노트 포함</span>' : ''}
    </div>
    <div class="flash-word">${escapeHtml(item.word)}</div>
    <div class="flash-answer">${state.flash.reveal ? escapeHtml(displayMeaning(item)) : '정답 보기를 눌러 뜻을 확인하세요.'}</div>
  `;
}

function stepFlash(delta) {
  if (!state.flash.order.length) return;
  state.flash.index = (state.flash.index + delta + state.flash.order.length) % state.flash.order.length;
  state.flash.reveal = false;
  renderFlashcard();
}

function getQuizPool() {
  return state.quiz.source === "wrong" ? getWrongItems() : getSelectedWords();
}

function choiceLabel(item, direction) {
  return direction === "engToKor" ? displayMeaning(item) : item.word;
}

function questionLabel(item, direction) {
  return direction === "engToKor" ? item.word : displayMeaning(item);
}

function buildQuizChoices(correctItem, pool, direction) {
  const correctLabel = choiceLabel(correctItem, direction);
  const others = shuffle(pool.filter((item) => item.id !== correctItem.id))
    .filter((item, idx, arr) => choiceLabel(item, direction) !== correctLabel && arr.findIndex((v) => choiceLabel(v, direction) === choiceLabel(item, direction)) === idx)
    .slice(0, 3);
  return shuffle([correctItem, ...others]);
}

function startQuiz() {
  let pool = getQuizPool();
  if (!pool.length) {
    const message = state.quiz.source === "wrong"
      ? '<div class="empty-state">오답노트에 저장된 단어가 없습니다.</div>'
      : renderSelectionPrompt("시험 범위를 먼저 골라 주세요.", "DAY를 선택하지 않으면 문제를 만들지 않습니다.");
    els.quizCard.innerHTML = message;
    updateQuizStats();
    return;
  }
  pool = shuffle(pool);
  const limit = Math.min(pool.length, state.quiz.count);
  state.quiz.queue = pool.slice(0, limit).map((item) => item.id);
  state.quiz.pointer = 0;
  state.quiz.correct = 0;
  state.quiz.wrong = 0;
  state.quiz.current = null;
  state.quiz.choices = [];
  state.quiz.answered = false;
  state.quiz.lastFeedback = "";
  state.quiz.userAnswer = "";
  nextQuizQuestion(true);
}

function nextQuizQuestion(isFresh = false) {
  if (!state.quiz.queue.length) {
    els.quizCard.innerHTML = `<div class="empty-state">시험 시작을 눌러 주세요.</div>`;
    updateQuizStats();
    return;
  }
  if (!isFresh && state.quiz.pointer >= state.quiz.queue.length - 1) {
    state.quiz.current = null;
    state.quiz.answered = true;
    state.quiz.lastFeedback = `시험 완료\n정답 ${state.quiz.correct}개 / 오답 ${state.quiz.wrong}개`;
    renderQuizCard();
    updateQuizStats();
    return;
  }
  if (!isFresh) state.quiz.pointer += 1;
  const current = state.byId.get(state.quiz.queue[state.quiz.pointer]);
  state.quiz.current = current;
  state.quiz.answered = false;
  state.quiz.lastFeedback = "";
  state.quiz.userAnswer = "";
  state.quiz.choices = state.quiz.mode === "multiple" ? buildQuizChoices(current, getQuizPool(), state.quiz.direction) : [];
  renderQuizCard();
  updateQuizStats();
}

function submitQuizAnswer(payload) {
  const item = state.quiz.current;
  if (!item || state.quiz.answered) return;
  let correct = false;
  let userAnswer = "";

  if (state.quiz.mode === "multiple") {
    userAnswer = payload?.choice || "";
    correct = userAnswer === choiceLabel(item, state.quiz.direction);
  } else {
    userAnswer = payload?.text || "";
    correct = isCorrectSubjective(userAnswer, item, state.quiz.direction);
  }

  state.quiz.answered = true;
  state.quiz.userAnswer = userAnswer;

  if (correct) {
    state.quiz.correct += 1;
    state.quiz.lastFeedback = `정답입니다!\n정답: ${state.quiz.direction === 'engToKor' ? displayMeaning(item) : item.word}`;
  } else {
    state.quiz.wrong += 1;
    addWrong(item, { source: "quiz", direction: state.quiz.direction, userAnswer });
    state.quiz.lastFeedback = `오답입니다.\n내 답: ${userAnswer || '(빈 답안)'}\n정답: ${state.quiz.direction === 'engToKor' ? displayMeaning(item) : item.word}`;
  }

  renderQuizCard();
  updateQuizStats();
  renderStats();
}

function renderQuizCard() {
  const item = state.quiz.current;
  if (!item) {
    if (state.quiz.source !== "wrong" && !hasSelection()) {
      els.quizCard.innerHTML = renderSelectionPrompt("시험 범위를 먼저 골라 주세요.", "오른쪽 위 메뉴에서 DAY를 체크한 뒤 시험 시작을 눌러 주세요.");
      return;
    }
    els.quizCard.innerHTML = `<div class="empty-state">${escapeHtml(state.quiz.lastFeedback || "시험 시작을 눌러 주세요.")}</div>`;
    return;
  }
  const feedbackClass = state.quiz.answered ? (state.quiz.lastFeedback.startsWith("정답") ? "good" : "bad") : "";
  const topMeta = `
    <div class="wrong-meta">
      <span class="meta-pill">${state.quiz.pointer + 1} / ${state.quiz.queue.length}</span>
      <span class="meta-pill">Day ${item.day}</span>
      ${displayCategory(item) ? `<span class="meta-pill">${escapeHtml(displayCategory(item))}</span>` : ""}
    </div>`;
  let body = "";
  if (state.quiz.mode === "multiple") {
    body = `
      <div class="choice-grid">
        ${state.quiz.choices.map((choice) => `
          <button class="choice-btn" type="button" data-choice-id="${choice.id}">${escapeHtml(choiceLabel(choice, state.quiz.direction))}</button>
        `).join("")}
      </div>`;
  } else {
    body = `
      <div class="answer-box">
        <input id="subjectiveAnswerInput" class="input" type="text" placeholder="정답 입력" autocomplete="off" />
        <button id="submitSubjectiveBtn" class="btn primary" type="button">제출</button>
      </div>`;
  }

  els.quizCard.innerHTML = `
    ${topMeta}
    <div class="quiz-question">${escapeHtml(questionLabel(item, state.quiz.direction))}</div>
    ${body}
    ${state.quiz.answered ? `<div class="feedback ${feedbackClass}">${escapeHtml(state.quiz.lastFeedback)}</div>` : ""}
    <div class="action-bar wrap">
      <button class="btn" id="quizRevealUs" type="button">🔊 US</button>
      <button class="btn" id="quizRevealUk" type="button">🔊 UK</button>
      ${state.quiz.answered ? '<button class="btn primary" id="quizNextBtnInline" type="button">다음 문제</button>' : ''}
    </div>
  `;

  els.quizCard.querySelectorAll("[data-choice-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const choice = state.byId.get(btn.dataset.choiceId);
      submitQuizAnswer({ choice: choiceLabel(choice, state.quiz.direction) });
    });
  });

  const input = document.getElementById("subjectiveAnswerInput");
  const submitBtn = document.getElementById("submitSubjectiveBtn");
  if (input && submitBtn) {
    submitBtn.addEventListener("click", () => submitQuizAnswer({ text: input.value }));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submitQuizAnswer({ text: input.value });
    });
    setTimeout(() => input.focus(), 20);
  }

  document.getElementById("quizRevealUs")?.addEventListener("click", () => speak(item.word, "en-US"));
  document.getElementById("quizRevealUk")?.addEventListener("click", () => speak(item.word, "en-GB"));
  document.getElementById("quizNextBtnInline")?.addEventListener("click", () => nextQuizQuestion(false));
}

function updateQuizStats() {
  const total = state.quiz.queue.length;
  const progress = total ? Math.min(state.quiz.pointer + (state.quiz.current ? 1 : total), total) : 0;
  els.quizProgressStat.textContent = `진행 ${progress}/${total}`;
  els.quizCorrectStat.textContent = `정답 ${state.quiz.correct}`;
  els.quizWrongStat.textContent = `오답 ${state.quiz.wrong}`;
}

function renderWrongTab() {
  const wrongItems = getWrongItems();
  els.wrongSummary.textContent = `저장된 오답 ${wrongItems.length.toLocaleString()}개`;
  if (!wrongItems.length) {
    els.wrongList.innerHTML = `<div class="empty">아직 저장된 오답이 없습니다.</div>`;
    return;
  }
  els.wrongList.innerHTML = wrongItems.map((item) => {
    const info = state.wrongs[item.id] || {};
    const known = state.known.has(item.id);
    return `
      <article class="wrong-card">
        <div class="wrong-card-top">
          <div>
            <h4>${escapeHtml(item.word)}</h4>
            <div class="subtext" style="margin-top:8px;">${escapeHtml(displayMeaning(item))}</div>
          </div>
          <div class="wrong-meta">
            <span class="meta-pill">Day ${item.day}</span>
            <span class="meta-pill">오답 ${info.count || 1}회</span>
            ${displayCategory(item) ? `<span class="meta-pill">${escapeHtml(displayCategory(item))}</span>` : ""}
            ${known ? '<span class="meta-pill">암기됨</span>' : ''}
          </div>
        </div>
        <div class="subtext">최근 오답: ${escapeHtml(formatDateTime(info.lastWrong))}</div>
        <div class="action-bar wrap">
          <button class="btn" data-action="speak-us" data-id="${item.id}" type="button">🔊 US</button>
          <button class="btn" data-action="speak-uk" data-id="${item.id}" type="button">🔊 UK</button>
          <button class="btn success" data-action="known" data-id="${item.id}" type="button">암기 체크</button>
          <button class="btn danger" data-action="wrong-remove" data-id="${item.id}" type="button">오답 삭제</button>
        </div>
      </article>`;
  }).join("");
}

function renderActiveTab() {
  if (state.tab === "home") renderHome();
  if (state.tab === "list") renderListTab();
  if (state.tab === "flash") renderFlashcard();
  if (state.tab === "quiz") renderQuizCard();
  if (state.tab === "wrong") renderWrongTab();
}

function setActiveTab(tabName) {
  state.tab = tabName;
  document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
  document.querySelectorAll("[id^='tab-']").forEach((panel) => panel.classList.add("hidden"));
  document.getElementById(`tab-${tabName}`)?.classList.remove("hidden");
  location.hash = tabName;
  renderActiveTab();
  if (window.innerWidth <= 980) setDrawerOpen(false);
}

function applyHashTab() {
  const hash = (location.hash || "").replace("#", "").trim();
  if (["home", "list", "flash", "quiz", "wrong"].includes(hash)) setActiveTab(hash);
}

function getVoiceScore(voice, targetLang) {
  const lang = String(voice.lang || "").toLowerCase();
  const name = String(voice.name || "").toLowerCase();
  let score = 0;
  if (lang === targetLang.toLowerCase()) score += 120;
  if (lang.startsWith(targetLang.toLowerCase())) score += 80;
  if (lang.startsWith("en")) score += 20;

  if (targetLang === "en-US") {
    if (/google us english|united states|american|en-us/.test(name)) score += 60;
    if (/microsoft (aria|jenny|guy|davis)|samantha/.test(name)) score += 35;
  } else {
    if (/google uk english|british|united kingdom|england|en-gb|en-uk/.test(name)) score += 60;
    if (/microsoft (libby|sonia|ryan)|daniel|serena|karen/.test(name)) score += 35;
  }

  if (voice.localService) score += 5;
  return score;
}

function pickBestVoice(targetLang) {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  const sorted = [...voices]
    .filter((voice) => String(voice.lang || "").toLowerCase().startsWith("en"))
    .sort((a, b) => getVoiceScore(b, targetLang) - getVoiceScore(a, targetLang));
  return sorted[0] || null;
}

function updateTtsStatus() {
  if (!("speechSynthesis" in window)) {
    els.ttsStatus.textContent = "이 브라우저는 TTS를 지원하지 않습니다.";
    els.ttsStatus.className = "install-status err";
    return;
  }
  const voices = window.speechSynthesis.getVoices();
  state.voices = voices;
  state.preferredVoices.us = pickBestVoice("en-US");
  state.preferredVoices.uk = pickBestVoice("en-GB");
  const usName = state.preferredVoices.us?.name || "없음";
  const ukName = state.preferredVoices.uk?.name || "없음";
  const sameish = state.preferredVoices.us && state.preferredVoices.uk && state.preferredVoices.us.name === state.preferredVoices.uk.name;
  const tone = sameish || !state.preferredVoices.uk ? "warn" : "ok";
  let message = `US: ${usName} / UK: ${ukName}`;
  if (sameish || !state.preferredVoices.uk) message += " · 기기에 영국식 전용 음성이 없어서 차이가 작을 수 있어요.";
  els.ttsStatus.textContent = message;
  els.ttsStatus.className = `install-status ${tone}`.trim();
}

function speak(text, lang) {
  if (!("speechSynthesis" in window)) {
    alert("이 브라우저는 음성 합성을 지원하지 않습니다.");
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  const voice = lang === "en-US" ? state.preferredVoices.us : state.preferredVoices.uk;
  if (voice) utter.voice = voice;
  utter.rate = 0.92;
  utter.pitch = 1;
  window.speechSynthesis.speak(utter);
}

function updateInstallStatus(message, tone = "") {
  els.installStatus.textContent = message;
  els.installStatus.className = `install-status ${tone}`.trim();
}

function isStandaloneMode() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    updateInstallStatus("이 브라우저는 오프라인 설치를 지원하지 않습니다.", "err");
    return;
  }
  if (location.protocol === "file:") {
    updateInstallStatus("설치하려면 웹서버나 GitHub Pages에서 열어야 합니다.", "warn");
    return;
  }
  try {
    await navigator.serviceWorker.register("./sw.js");
    updateInstallStatus(isStandaloneMode() ? "앱처럼 실행 중입니다." : "오프라인 캐시 준비 완료", "ok");
  } catch (err) {
    console.error(err);
    updateInstallStatus("오프라인 캐시 등록에 실패했습니다.", "err");
  }
}

function setupInstallPrompt() {
  const btn = els.installAppBtn;
  if (isStandaloneMode()) {
    btn.disabled = true;
    btn.textContent = "설치됨";
    updateInstallStatus("홈 화면 앱으로 실행 중입니다.", "ok");
  } else if (location.protocol === "file:") {
    btn.disabled = true;
    btn.textContent = "웹서버 필요";
    updateInstallStatus("GitHub Pages나 localhost에서 열면 설치됩니다.", "warn");
  } else {
    btn.disabled = true;
    btn.textContent = "앱 설치";
    updateInstallStatus("브라우저가 설치 가능 여부를 확인 중입니다.");
  }
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    btn.disabled = false;
    updateInstallStatus("홈 화면에 설치할 수 있습니다.", "ok");
  });
  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    btn.disabled = true;
    btn.textContent = "설치됨";
    updateInstallStatus("설치가 완료되었습니다.", "ok");
  });
}

async function tryInstallApp() {
  if (!deferredInstallPrompt) {
    if (location.protocol === "file:") updateInstallStatus("웹서버/호스팅에서 열어 주세요.", "warn");
    else if (isStandaloneMode()) updateInstallStatus("이미 설치되어 있습니다.", "ok");
    else updateInstallStatus("브라우저 메뉴의 홈 화면 추가를 사용해 보세요.", "warn");
    return;
  }
  deferredInstallPrompt.prompt();
  const { outcome } = await deferredInstallPrompt.userChoice;
  updateInstallStatus(outcome === "accepted" ? "설치 요청을 보냈습니다." : "설치가 취소되었습니다.", outcome === "accepted" ? "ok" : "warn");
  deferredInstallPrompt = null;
  els.installAppBtn.disabled = true;
}

function exportWrongJson() {
  const items = getWrongItems().map((item) => {
    const info = state.wrongs[item.id] || {};
    return {
      id: item.id,
      day: item.day,
      category: item.category,
      word: item.word,
      meaning: displayMeaning(item),
      wrongCount: info.count || 1,
      lastWrong: info.lastWrong || null,
    };
  });
  const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "toeic_vocab_wrong_note.json";
  a.click();
  URL.revokeObjectURL(url);
}

function applyTheme(choice) {
  const html = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const actual = choice === "auto" ? (systemDark ? "dark" : "light") : choice;
  html.dataset.theme = actual;
  document.querySelectorAll("[data-theme-choice]").forEach((btn) => btn.classList.toggle("active", btn.dataset.themeChoice === choice));
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", actual === "dark" ? "#0f172a" : "#ffffff");
}

function setupTheme() {
  const choice = localStorage.getItem(STORAGE_KEYS.themeChoice) || "auto";
  applyTheme(choice);
  document.getElementById("themeToggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-choice]");
    if (!btn) return;
    const nextChoice = btn.dataset.themeChoice;
    saveThemeChoice(nextChoice);
    applyTheme(nextChoice);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => {
    if ((localStorage.getItem(STORAGE_KEYS.themeChoice) || "auto") === "auto") applyTheme("auto");
  });
}

function handleItemAction(action, id) {
  const item = state.byId.get(id);
  if (!item) return;
  if (action === "speak-us") speak(item.word, "en-US");
  if (action === "speak-uk") speak(item.word, "en-GB");
  if (action === "known") toggleKnown(item.id);
  if (action === "wrong") {
    addWrong(item, { source: "manual" });
    renderActiveTab();
  }
  if (action === "wrong-remove") {
    removeWrong(item.id);
    renderActiveTab();
  }
}

function bindEvents() {
  document.getElementById("tabs").addEventListener("click", (e) => {
    const btn = e.target.closest(".tab-btn");
    if (btn) setActiveTab(btn.dataset.tab);
  });

  document.getElementById("menuOpenBtn")?.addEventListener("click", () => setDrawerOpen(true));
  document.getElementById("drawerCloseBtn")?.addEventListener("click", () => setDrawerOpen(false));
  document.getElementById("drawerBackdrop")?.addEventListener("click", () => setDrawerOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setDrawerOpen(false);
  });

  els.dayGrid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    const day = Number(btn.dataset.day);
    if (state.selectedDays.has(day)) state.selectedDays.delete(day);
    else state.selectedDays.add(day);
    state.page = 1;
    invalidateFilteredCache();
    resetFlashOrder();
    updateDayGridSelection();
    renderStats();
    renderActiveTab();
  });
  els.wordList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action][data-id]");
    if (btn) handleItemAction(btn.dataset.action, btn.dataset.id);
  });
  els.wrongList.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action][data-id]");
    if (btn) handleItemAction(btn.dataset.action, btn.dataset.id);
  });
  document.getElementById("selectAllDaysBtn").addEventListener("click", () => selectDays(state.days));
  document.getElementById("clearDaysBtn").addEventListener("click", () => selectDays([]));
  els.searchInput.addEventListener("input", (e) => {
    const value = e.target.value.trim();
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.search = value;
      state.page = 1;
      invalidateFilteredCache();
      resetFlashOrder();
      renderStats();
      renderActiveTab();
    }, 120);
  });
  document.getElementById("clearSearchBtn").addEventListener("click", () => {
    els.searchInput.value = "";
    state.search = "";
    state.page = 1;
    invalidateFilteredCache();
    resetFlashOrder();
    renderStats();
    renderActiveTab();
  });
  els.sortSelect.addEventListener("change", (e) => {
    state.sort = e.target.value;
    if (state.sort === "random") state.viewOrderSeed = Date.now();
    state.page = 1;
    invalidateFilteredCache();
    resetFlashOrder();
    renderStats();
    renderActiveTab();
  });
  els.pageSizeSelect.addEventListener("change", (e) => {
    state.pageSize = Number(e.target.value);
    state.page = 1;
    renderActiveTab();
  });
  document.getElementById("prevPageBtn").addEventListener("click", () => {
    state.page = Math.max(1, state.page - 1);
    renderListTab();
  });
  document.getElementById("nextPageBtn").addEventListener("click", () => {
    const total = Math.max(1, Math.ceil(getSelectedWords().length / state.pageSize));
    state.page = Math.min(total, state.page + 1);
    renderListTab();
  });
  document.getElementById("shuffleVisibleBtn").addEventListener("click", () => {
    state.sort = "random";
    state.viewOrderSeed = Date.now();
    els.sortSelect.value = "random";
    invalidateFilteredCache();
    state.page = 1;
    resetFlashOrder();
    renderStats();
    renderListTab();
  });
  document.getElementById("exportWrongJsonBtn").addEventListener("click", exportWrongJson);
  document.getElementById("flashPrevBtn").addEventListener("click", () => stepFlash(-1));
  document.getElementById("flashNextBtn").addEventListener("click", () => stepFlash(1));
  document.getElementById("flashToggleBtn").addEventListener("click", () => {
    state.flash.reveal = !state.flash.reveal;
    renderFlashcard();
  });
  document.getElementById("flashShuffleBtn").addEventListener("click", () => {
    state.flash.order = shuffle(getSelectedWords().map((item) => item.id));
    state.flash.index = 0;
    state.flash.reveal = false;
    renderFlashcard();
  });
  document.getElementById("flashResetBtn").addEventListener("click", () => {
    resetFlashOrder();
    renderFlashcard();
  });
  document.getElementById("flashUsBtn").addEventListener("click", () => currentFlashItem() && speak(currentFlashItem().word, "en-US"));
  document.getElementById("flashUkBtn").addEventListener("click", () => currentFlashItem() && speak(currentFlashItem().word, "en-GB"));
  document.getElementById("flashKnowBtn").addEventListener("click", () => currentFlashItem() && toggleKnown(currentFlashItem().id));
  document.getElementById("flashMissBtn").addEventListener("click", () => {
    const item = currentFlashItem();
    if (!item) return;
    addWrong(item, { source: "flash" });
    renderFlashcard();
  });
  els.quizModeSelect.addEventListener("change", () => state.quiz.mode = els.quizModeSelect.value);
  els.quizDirectionSelect.addEventListener("change", () => state.quiz.direction = els.quizDirectionSelect.value);
  els.quizSourceSelect.addEventListener("change", () => state.quiz.source = els.quizSourceSelect.value);
  els.quizCountSelect.addEventListener("change", () => state.quiz.count = Number(els.quizCountSelect.value));
  document.getElementById("startQuizBtn").addEventListener("click", startQuiz);
  document.getElementById("speakQuizUsBtn").addEventListener("click", () => state.quiz.current && speak(state.quiz.current.word, "en-US"));
  document.getElementById("speakQuizUkBtn").addEventListener("click", () => state.quiz.current && speak(state.quiz.current.word, "en-GB"));
  document.getElementById("practiceWrongBtn").addEventListener("click", () => {
    setActiveTab("quiz");
    els.quizSourceSelect.value = "wrong";
    els.quizModeSelect.value = "multiple";
    state.quiz.source = "wrong";
    state.quiz.mode = "multiple";
    startQuiz();
  });
  document.getElementById("clearWrongBtn").addEventListener("click", () => {
    if (!confirm("오답노트를 전체 삭제할까요?")) return;
    state.wrongs = {};
    saveWrongs();
    renderStats();
    renderWrongTab();
  });
  document.getElementById("homeOpenListBtn")?.addEventListener("click", () => setActiveTab("list"));
  document.getElementById("homeOpenFlashBtn")?.addEventListener("click", () => setActiveTab("flash"));
  document.getElementById("homeOpenQuizBtn")?.addEventListener("click", () => setActiveTab("quiz"));
  document.getElementById("homeOpenWrongBtn")?.addEventListener("click", () => setActiveTab("wrong"));

  document.addEventListener("click", (e) => {
    const presetBtn = e.target.closest("[data-selection-preset]");
    if (!presetBtn) return;
    const preset = presetBtn.dataset.selectionPreset;
    if (preset === "day1") {
      selectDays([1]);
      if (state.tab === "home") setActiveTab("list");
    }
    if (preset === "all") {
      selectDays(state.days);
      if (state.tab === "home") setActiveTab("list");
    }
    if (preset === "menu") setDrawerOpen(true);
  });

  els.installAppBtn.addEventListener("click", tryInstallApp);
  window.addEventListener("hashchange", applyHashTab);
}

async function loadData() {
  const response = await fetch("./toeic_vocab_data.json", { cache: "force-cache" });
  if (!response.ok) throw new Error(`단어 데이터를 불러오지 못했습니다: ${response.status}`);
  const data = await response.json();
  buildDataIndexes(data);
}

async function boot() {
  initElements();
  setupTheme();
  setupInstallPrompt();
  bindEvents();
  try {
    await loadData();
    renderDayGrid();
    renderStats();
    resetFlashOrder();
    els.loadingPanel.classList.add("hidden");
    setActiveTab("home");
    applyHashTab();
    registerServiceWorker();
    if ("speechSynthesis" in window) {
      updateTtsStatus();
      window.speechSynthesis.onvoiceschanged = () => updateTtsStatus();
      setTimeout(updateTtsStatus, 500);
    } else {
      updateTtsStatus();
    }
  } catch (err) {
    console.error(err);
    els.loadingPanel.innerHTML = `<div class="empty-state">앱을 불러오지 못했습니다.<br>${escapeHtml(err.message || String(err))}</div>`;
  }
}

boot();
