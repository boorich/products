const width = () => document.getElementById("graph").clientWidth;
const height = () => document.getElementById("graph").clientHeight || (window.innerHeight - 110);

const panelContent = document.getElementById("panelContent");
const panelErrors = document.getElementById("panelErrors");
const routineDaily = document.getElementById("routineDaily");
const routineWeekly = document.getElementById("routineWeekly");
const routineHistory = document.getElementById("routineHistory");

let svg, simulation, data, nodeSel, linkSel;

// Vacation config
const VACATION_START = "2026-02-01";

const RULES = {
  // NICPD: no implicit mutual definition / no hard depends-on edges between CPDs
  forbidDependsOnBetweenCPD: true,
  allowedLinkTypes: new Set(["uses", "inspired-by"])
};

// Routine system - Focused on status field maintenance
const CPD_STATUS_FIELDS = [
  { key: "customerResearchData", label: "Customer Research Data" },
  { key: "valuePropositionClarity", label: "Value Proposition Clarity" },
  { key: "pricingEconomicModel", label: "Pricing / Economic Model" },
  { key: "reliabilitySLO", label: "Reliability SLO" },
  { key: "securityRiskPosture", label: "Security Risk Posture" },
  { key: "operationalOwnership", label: "Operational Ownership" }
];

const CCD_STATUS_FIELDS = [
  { key: "userAudienceEvidence", label: "User Audience Evidence" },
  { key: "problemDefinitionClarity", label: "Problem Definition Clarity" },
  { key: "adoptionEvidence", label: "Adoption Evidence" },
  { key: "productizationEligibility", label: "Productization Eligibility" },
  { key: "ownershipStatus", label: "Ownership Status" },
  { key: "standardizationRisk", label: "Standardization Risk" }
];

// Daily tasks are generated dynamically per node
// This function creates tasks for all nodes in the data
function generateDailyTasks(data) {
  if (!data || !data.nodes) return [];
  
  const tasks = [];
  
  data.nodes.forEach(node => {
    if (node.type === "CPD") {
      CPD_STATUS_FIELDS.forEach(field => {
        tasks.push({
          id: `review_${node.id}_${field.key}`,
          nodeId: node.id,
          nodeName: node.name,
          fieldKey: field.key,
          label: field.label,
          nodeType: "CPD",
          text: `${node.name}: ${field.label}`
        });
      });
    } else if (node.type === "CCD") {
      CCD_STATUS_FIELDS.forEach(field => {
        tasks.push({
          id: `review_${node.id}_${field.key}`,
          nodeId: node.id,
          nodeName: node.name,
          fieldKey: field.key,
          label: field.label,
          nodeType: "CCD",
          text: `${node.name}: ${field.label}`
        });
      });
    }
  });
  
  return tasks;
}

const WEEKLY_TASKS = [
  { id: "W1", text: "Run Validate and review all Errors/Warnings." },
  { id: "W2", text: "Resolve all ERRORS this week (or mark as acknowledged with a reason)." },
  { id: "W3", text: "Pick 1 CPD and answer: 'What decision did this product enable this week?' (write 1 sentence in CPD)." },
  { id: "W4", text: "Review CCDs for misuse: no product language, no implied commitments." },
  { id: "W5", text: "Pre-vacation hardening check (if within 14 days before a configured vacation date): ensure every CPD has OperationalOwnership ≠ NONE." }
];

function getTodayKey() {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

function getWeekKey() {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
  const monday = new Date(now.setDate(diff));
  return monday.toISOString().split('T')[0]; // YYYY-MM-DD of Monday
}

function isWithin14DaysBeforeVacation() {
  const vacation = new Date(VACATION_START);
  const today = new Date();
  const diffDays = Math.ceil((vacation - today) / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= 14;
}

function loadRoutineState(key) {
  const stored = localStorage.getItem(`routine_${key}`);
  return stored ? JSON.parse(stored) : {};
}

function saveRoutineState(key, state) {
  localStorage.setItem(`routine_${key}`, JSON.stringify(state));
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

function getAcknowledgedErrors(weekKey) {
  const stored = localStorage.getItem(`ack_${weekKey}`);
  return stored ? JSON.parse(stored) : {};
}

function calculateStreaks() {
  if (!data || !data.nodes) return { dailyStreak: 0, weeklyStreak: 0 };
  
  const today = new Date();
  let dailyStreak = 0;
  let weeklyStreak = 0;
  
  // Generate tasks from current data structure
  const tasks = generateDailyTasks(data);
  const minTasksForStreak = Math.max(3, Math.floor(tasks.length * 0.2)); // At least 3, or 20% of total tasks
  
  // Calculate daily streak (consecutive days with at least minTasksForStreak tasks completed)
  for (let i = 0; i < 365; i++) {
    const checkDate = new Date(today);
    checkDate.setDate(checkDate.getDate() - i);
    const dateKey = checkDate.toISOString().split('T')[0];
    const state = loadRoutineState(dateKey);
    const completed = tasks.filter(t => state[t.id]).length;
    
    if (i === 0) {
      // Today: count if at least minTasksForStreak tasks done
      if (completed >= minTasksForStreak) {
        dailyStreak = 1;
      } else {
        break;
      }
    } else {
      // Past days: must have at least minTasksForStreak tasks completed
      if (completed >= minTasksForStreak) {
        dailyStreak++;
      } else {
        break;
      }
    }
  }
  
  // Calculate weekly streak (consecutive weeks with at least 3 tasks completed)
  for (let w = 0; w < 52; w++) {
    const checkDate = new Date(today);
    const day = checkDate.getDay();
    const diff = checkDate.getDate() - day + (day === 0 ? -6 : 1) - (w * 7); // Monday of week
    const monday = new Date(checkDate.setDate(diff));
    const weekKey = monday.toISOString().split('T')[0];
    const state = loadRoutineState(weekKey);
    const completed = WEEKLY_TASKS.filter(t => state[t.id]).length;
    
    if (w === 0) {
      // This week: count if at least 3 tasks done
      if (completed >= 3) {
        weeklyStreak = 1;
      } else {
        break;
      }
    } else {
      // Past weeks: must have at least 3 tasks completed
      if (completed >= 3) {
        weeklyStreak++;
      } else {
        break;
      }
    }
  }
  
  return { dailyStreak, weeklyStreak };
}

function acknowledgeError(message, reason, weekKey) {
  const acks = getAcknowledgedErrors(weekKey);
  const msgHash = hashString(message);
  acks[msgHash] = { message, reason, timestamp: Date.now() };
  localStorage.setItem(`ack_${weekKey}`, JSON.stringify(acks));
}

function pickCPDForMe() {
  if (!data || !data.nodes) return null;
  
  const cpds = data.nodes.filter(n => n.type === "CPD");
  if (cpds.length === 0) return null;
  
  const scored = cpds.map(node => {
    let score = 0;
    const status = node.status || node.cpd?.status || {};
    const reasons = [];
    
    // Score by status values
    for (const [key, value] of Object.entries(status)) {
      const val = String(value).toUpperCase();
      if (val === "TBD") {
        score += 3;
        reasons.push(`${key}=TBD`);
      } else if (val === "NONE") {
        score += 2;
        reasons.push(`${key}=NONE`);
      }
    }
    
    // Score by lifecycle
    const lifecycle = node.cpd?.lifecycle || "";
    if (lifecycle.includes("Growth") || lifecycle.includes("Incubation")) {
      score += 1;
    }
    
    return { node, score, reasons: reasons.slice(0, 3) };
  });
  
  // Sort by score (desc), then by id (asc)
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.node.id.localeCompare(b.node.id);
  });
  
  return scored[0];
}

function renderRoutines() {
  if (!data || !data.nodes) {
    routineDaily.innerHTML = '<div style="padding: 16px; color: var(--muted); font-size: 12px;">Loading...</div>';
    return;
  }
  
  const todayKey = getTodayKey();
  const dailyState = loadRoutineState(todayKey);
  const streaks = calculateStreaks();
  
  // Generate tasks dynamically from current nodes
  const allTasks = generateDailyTasks(data);
  
  // Show only the 12 oldest tasks (most overdue)
  const DAILY_TASKS = getOldestTasks(allTasks, 12);
  
  const completed = DAILY_TASKS.filter(t => dailyState[t.id]).length;
  const total = DAILY_TASKS.length;
  const totalAllTasks = allTasks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  
  // Clean, focused daily routine UI
  let dailyHtml = `
    <div style="margin-bottom: 20px; padding: 16px; background: linear-gradient(135deg, rgba(102, 204, 255, 0.12) 0%, rgba(102, 204, 255, 0.05) 100%); border: 1px solid rgba(102, 204, 255, 0.2); border-radius: 12px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div>
          <div style="font-size: 13px; font-weight: 600; color: var(--text); margin-bottom: 4px;">Daily Status Review</div>
          <div style="font-size: 11px; color: var(--muted);">Keep product health in sync</div>
        </div>
        <div style="text-align: right;">
          <div style="font-size: 20px; font-weight: 700; color: rgba(102, 204, 255, 0.9);">${percent}%</div>
          <div style="font-size: 10px; color: var(--muted);">${completed}/${total}${totalAllTasks > total ? ` of ${totalAllTasks}` : ''}</div>
        </div>
      </div>
      
      <div style="margin-bottom: 12px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
        <div style="height: 100%; width: ${percent}%; background: linear-gradient(90deg, rgba(102, 204, 255, 0.8) 0%, rgba(153, 255, 153, 0.8) 100%); border-radius: 3px; transition: width 0.3s ease;"></div>
      </div>
      
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 12px;">
  `;
  
  DAILY_TASKS.forEach(task => {
    const checked = dailyState[task.id] || false;
    const field = task.nodeType === "CPD" 
      ? CPD_STATUS_FIELDS.find(f => f.key === task.fieldKey)
      : CCD_STATUS_FIELDS.find(f => f.key === task.fieldKey);
    // Use last word of label for short display
    const shortLabel = field ? field.label.split(' ').slice(-1)[0] : (task.label.split(' ').slice(-1)[0] || task.label);
    // Show node name and field
    const displayLabel = `${task.nodeName}: ${shortLabel}`;
    
    dailyHtml += `
      <div style="padding: 10px; background: ${checked ? 'rgba(153, 255, 153, 0.15)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${checked ? 'rgba(153, 255, 153, 0.4)' : 'rgba(255,255,255,0.1)'}; border-radius: 8px; transition: all 0.2s;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <div style="width: 20px; height: 20px; border-radius: 4px; background: ${checked ? 'rgba(153, 255, 153, 0.3)' : 'rgba(255,255,255,0.1)'}; display: flex; align-items: center; justify-content: center; font-size: 12px;">
            ${checked ? '✓' : ''}
          </div>
          <div style="flex: 1; font-size: 11px; font-weight: 600; color: ${checked ? 'var(--muted)' : 'var(--text)'}; ${checked ? 'text-decoration: line-through;' : ''}">
            ${escapeHtml(displayLabel)}
          </div>
        </div>
        <div style="font-size: 9px; color: var(--muted); margin-left: 28px;">
          ${checked ? 'Reviewed' : 'Pending'}
        </div>
      </div>
    `;
  });
  
  dailyHtml += `
      </div>
      
      <div style="padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
        <button onclick="pickAndShowCPD()" style="width: 100%; padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 8px; color: var(--text); cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s; margin-bottom: 8px;" onmouseover="this.style.background='rgba(102, 204, 255, 0.3)'" onmouseout="this.style.background='rgba(102, 204, 255, 0.2)'">
          🎯 Review a CPD
        </button>
        <button onclick="resetToday()" style="width: 100%; padding: 6px; background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; color: var(--muted); cursor: pointer; font-size: 10px; transition: all 0.2s;" onmouseover="this.style.borderColor='rgba(255,255,255,0.2)'" onmouseout="this.style.borderColor='rgba(255,255,255,0.1)'">
          Reset today
        </button>
      </div>
      
      ${streaks.dailyStreak > 0 ? `
      <div style="margin-top: 12px; padding: 8px; background: rgba(255, 204, 102, 0.1); border: 1px solid rgba(255, 204, 102, 0.3); border-radius: 6px; text-align: center;">
        <div style="font-size: 11px; color: var(--muted);">🔥 Streak</div>
        <div style="font-size: 16px; font-weight: 700; color: rgba(255, 204, 102, 0.9);">${streaks.dailyStreak} day${streaks.dailyStreak !== 1 ? 's' : ''}</div>
      </div>
      ` : ''}
    </div>
  `;
  
  routineDaily.innerHTML = dailyHtml;
}

// Daily tasks now auto-complete, but keep this for manual override if needed
window.toggleDailyTask = function(taskId) {
  const todayKey = getTodayKey();
  const state = loadRoutineState(todayKey);
  state[taskId] = !state[taskId];
  saveRoutineState(todayKey, state);
  renderRoutines();
};

window.toggleWeeklyTask = function(taskId) {
  const weekKey = getWeekKey();
  const state = loadRoutineState(weekKey);
  state[taskId] = !state[taskId];
  saveRoutineState(weekKey, state);
  renderRoutines();
};

window.pickAndShowCPD = function() {
  const result = pickCPDForMe();
  if (!result) {
    alert("No CPD nodes found.");
    return;
  }
  
  const { node, reasons } = result;
  
  // Auto-select the node (this will auto-complete tasks via showNode -> markStatusFieldsReviewed)
  showNode(node);
  
  // Show reason
  if (reasons.length > 0) {
    setTimeout(() => {
      alert(`Selected because: ${reasons.join(", ")}`);
    }, 100);
  }
};

// Removed confirmNoChange - tasks now auto-complete when viewing CPDs

window.resetToday = function() {
  if (confirm("Reset today's routine?")) {
    const todayKey = getTodayKey();
    localStorage.removeItem(`routine_${todayKey}`);
    renderRoutines();
  }
};

window.resetWeek = function() {
  if (confirm("Reset this week's routine?")) {
    const weekKey = getWeekKey();
    localStorage.removeItem(`routine_${weekKey}`);
    renderRoutines();
  }
};

function load() {
  fetch("data.json")
    .then(r => r.json())
    .then(json => {
      data = json;
      initGraph();
      render();
      showIntro();
      // Auto-reset check
      const lastDailyKey = localStorage.getItem('lastDailyKey');
      const todayKey = getTodayKey();
      if (lastDailyKey && lastDailyKey !== todayKey) {
        // New day - daily routines auto-reset (state cleared)
        localStorage.setItem('lastDailyKey', todayKey);
      } else if (!lastDailyKey) {
        localStorage.setItem('lastDailyKey', todayKey);
      }
      
      const lastWeekKey = localStorage.getItem('lastWeekKey');
      const weekKey = getWeekKey();
      if (lastWeekKey && lastWeekKey !== weekKey) {
        // New week - weekly routines auto-reset (state cleared)
        localStorage.setItem('lastWeekKey', weekKey);
      } else if (!lastWeekKey) {
        localStorage.setItem('lastWeekKey', weekKey);
      }
      
      renderRoutines();
    });
}

function initGraph() {
  const container = document.getElementById("graph");
  container.innerHTML = "";

  svg = d3.select(container)
    .append("svg")
    .attr("width", width())
    .attr("height", height());

  svg.append("defs").html(`
    <marker id="arrow" viewBox="0 -5 10 10" refX="18" refY="0" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M0,-5L10,0L0,5" fill="rgba(230,233,242,0.28)"></path>
    </marker>
  `);

  simulation = d3.forceSimulation(data.nodes)
    .force("link", d3.forceLink(data.links).id(d => d.id).distance(95).strength(0.8))
    .force("charge", d3.forceManyBody().strength(-520))
    .force("center", d3.forceCenter(width() / 2, height() / 2))
    .force("collide", d3.forceCollide().radius(d => d.type === "CPD" ? 34 : 28));

  window.addEventListener("resize", () => {
    svg.attr("width", width()).attr("height", height());
    simulation.force("center", d3.forceCenter(width()/2, height()/2));
    simulation.alpha(0.6).restart();
  });
  
  // Update SVG size when panel content changes (affects layout)
  const observer = new MutationObserver(() => {
    svg.attr("width", width()).attr("height", height());
    simulation.force("center", d3.forceCenter(width()/2, height()/2));
  });
  
  // Observe the panel for content changes that might affect graph height
  const panel = document.getElementById("panel");
  if (panel) {
    observer.observe(panel, { childList: true, subtree: true });
  }

  document.getElementById("btnRecenter").addEventListener("click", () => {
    simulation.alpha(0.8).restart();
  });

  document.getElementById("btnValidate").addEventListener("click", () => {
    const result = validateSystem(data);
    showValidation(result);
    // Mark W1 as complete when validation is run
    const weekKey = getWeekKey();
    const state = loadRoutineState(weekKey);
    state["W1"] = true;
    saveRoutineState(weekKey, state);
    
    renderRoutines();
  });

  document.getElementById("btnCreateNew").addEventListener("click", () => {
    showCreateForm();
  });
}

function render() {
  linkSel = svg.append("g")
    .attr("stroke", "rgba(230,233,242,0.18)")
    .attr("stroke-width", 1.2)
    .selectAll("line")
    .data(data.links)
    .enter()
    .append("line")
    .attr("marker-end", "url(#arrow)")
    .attr("stroke-dasharray", d => d.type === "inspired-by" ? "4 4" : null);

  linkSel.append("title").text(d => {
      if (d.type === "uses") return "optional usage, no dependency";
      if (d.type === "inspired-by") return "idea source, no implicit definition";
      return d.type;
      });

  nodeSel = svg.append("g")
    .selectAll("g")
    .data(data.nodes)
    .enter()
    .append("g")
    .call(drag(simulation))
    .on("click", (_e, d) => showNode(d));

  nodeSel.append("circle")
    .attr("r", d => d.type === "CPD" ? 26 : 22)
    .attr("fill", d => d.type === "CPD" ? "rgba(102,204,255,0.15)" : "rgba(153,255,153,0.12)")
    .attr("stroke", d => d.type === "CPD" ? "rgba(102,204,255,0.6)" : "rgba(153,255,153,0.55)")
    .attr("stroke-width", 1.6);

  nodeSel.append("text")
    .text(d => d.type)
    .attr("text-anchor", "middle")
    .attr("dy", 4)
    .attr("fill", "rgba(230,233,242,0.9)")
    .attr("font-size", 11)
    .attr("font-weight", 700);

  nodeSel.append("title").text(d => d.name);

  simulation.on("tick", () => {
    // Constrain nodes to stay within canvas bounds
    // Use the actual graph container dimensions (not SVG) to account for layout changes
    const graphContainer = document.getElementById("graph");
    const containerWidth = graphContainer.clientWidth;
    const containerHeight = graphContainer.clientHeight;
    const nodeRadius = (d) => d.type === "CPD" ? 26 : 22;
    const padding = 5; // Extra padding from edges
    
    data.nodes.forEach(d => {
      const r = nodeRadius(d);
      d.x = Math.max(r + padding, Math.min(containerWidth - r - padding, d.x));
      d.y = Math.max(r + padding, Math.min(containerHeight - r - padding, d.y));
    });
    
    linkSel
      .attr("x1", d => d.source.x)
      .attr("y1", d => d.source.y)
      .attr("x2", d => d.target.x)
      .attr("y2", d => d.target.y);

    nodeSel.attr("transform", d => `translate(${d.x},${d.y})`);
  });

  // Link labels (minimal)
  svg.append("g")
    .selectAll("text")
    .data(data.links)
    .enter()
    .append("text")
    .attr("fill", "rgba(154,163,178,0.9)")
    .attr("font-size", 11)
    .text(d => d.type)
    .each(function(d) { d._label = this; });

  simulation.on("tick.labels", () => {
    svg.selectAll("text")
      .filter(function() { return this.__data__ && this.__data__.source; })
      .attr("x", d => (d.source.x + d.target.x) / 2)
      .attr("y", d => (d.source.y + d.target.y) / 2);
  });
}

function showNode(d) {
  document.querySelector(".panelEmpty")?.classList?.add("hidden");
  panelContent.classList.remove("hidden");
  hideIntro();

  // Store current node globally
  window.currentNode = d;
  
  if (d.type === "CPD") {
    renderCPD(d);
  }
  if (d.type === "CCD") renderCCD(d);
  
  // Routines stay visible (already rendered at top)
}

window.openNodeDocument = function(node, fieldKey) {
  const repoInfo = getGitHubRepoInfo();
  let owner, repo;
  
  if (repoInfo && repoInfo.owner && repoInfo.repo) {
    owner = repoInfo.owner;
    repo = repoInfo.repo;
  } else {
    // Fallback: try to construct from current URL (GitHub Pages format)
    const hostname = window.location.hostname;
    if (hostname.includes('github.io')) {
      const parts = hostname.split('.');
      owner = parts[0];
      const pathParts = window.location.pathname.split('/').filter(p => p);
      repo = pathParts[0] || 'capability-system';
    } else {
      alert("GitHub repository info not configured. Please set it up in the Create New flow, or manually open the document in GitHub.");
      return;
    }
  }
  
  // Construct GitHub file URL - documents are stored in docs/ directory
  // Try both possible paths (with and without subdirectories)
  const docPath = node.type === "CPD" 
    ? `docs/cpds/${node.id}.md`
    : `docs/ccds/${node.id}.md`;
  
  // Also try alternative path (directly in docs/)
  const altDocPath = `docs/${node.id}.md`;
  
  // Try primary path first, fallback to alternative
  const githubUrl = `https://github.com/${owner}/${repo}/blob/master/${docPath}`;
  const altGithubUrl = `https://github.com/${owner}/${repo}/blob/master/${altDocPath}`;
  
  // Mark task as complete when user opens the document
  markFieldTaskComplete(node.id, fieldKey);
  
  // Open primary URL (user can navigate if file doesn't exist)
  window.open(githubUrl, '_blank');
};

function markFieldTaskComplete(nodeId, fieldKey) {
  const todayKey = getTodayKey();
  const state = loadRoutineState(todayKey);
  const taskId = `review_${nodeId}_${fieldKey}`;
  state[taskId] = true;
  // Store completion date for "oldest" calculation
  state[`${taskId}_date`] = todayKey;
  saveRoutineState(todayKey, state);
  
  // Also store in a global completion history (for cross-day tracking)
  const completionHistory = JSON.parse(localStorage.getItem('taskCompletionHistory') || '{}');
  completionHistory[taskId] = todayKey;
  localStorage.setItem('taskCompletionHistory', JSON.stringify(completionHistory));
  
  renderRoutines();
}

function getTaskAge(taskId) {
  // Get last completion date from history
  const completionHistory = JSON.parse(localStorage.getItem('taskCompletionHistory') || '{}');
  const lastCompleted = completionHistory[taskId];
  
  if (!lastCompleted) {
    // Never completed = oldest possible (return very large number)
    return Infinity;
  }
  
  // Calculate days since last completion
  const lastDate = new Date(lastCompleted);
  const today = new Date();
  const diffTime = today - lastDate;
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays;
}

function getOldestTasks(tasks, limit = 12) {
  // Calculate age for each task
  const tasksWithAge = tasks.map(task => ({
    ...task,
    age: getTaskAge(task.id)
  }));
  
  // Sort by age (oldest first), then by node name for consistency
  tasksWithAge.sort((a, b) => {
    if (b.age !== a.age) return b.age - a.age; // Older first
    return a.nodeName.localeCompare(b.nodeName); // Then alphabetically
  });
  
  // Return top N oldest tasks
  return tasksWithAge.slice(0, limit);
}

function renderCPD(node) {
  const c = node.cpd;
  panelContent.innerHTML = `
    <h2><span class="badge cpd">CPD</span>${escapeHtml(node.name)}</h2>

    <h3>1. Product Name</h3>
    <div class="kv"><div class="k">Name</div><div class="v">${escapeHtml(c.productName)}</div></div>

    <h3>2. What is this product?</h3>
    <p>${escapeHtml(c.whatIs)}</p>

    <h3>3. What is this product explicitly not?</h3>
    <ul>${c.whatIsNot.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

    <h3>4. Non-implicit decision</h3>
    <p><b>${escapeHtml(c.neverImplicit)}</b></p>

    <h3>5. Ownership</h3>
    <div class="kv">
      <div class="k">Product Owner</div><div class="v">${escapeHtml(c.ownership.productOwner)}</div>
      <div class="k">Delivery Owner</div><div class="v">${escapeHtml(c.ownership.deliveryOwner)}</div>
      <div class="k">Technical Authority</div><div class="v">${escapeHtml(c.ownership.technicalAuthority)}</div>
    </div>

    <h3>6. Decision Level</h3>
    <div class="kv">
      <div class="k">Implementation</div><div class="v">${escapeHtml(c.decisionLevel.implementation)}</div>
      <div class="k">Scope/Priority</div><div class="v">${escapeHtml(c.decisionLevel.scopePriority)}</div>
      <div class="k">Lifecycle/Go-No-Go</div><div class="v">${escapeHtml(c.decisionLevel.lifecycleGoNoGo)}</div>
    </div>

    <h3>7. Lifecycle Stage</h3>
    <div class="kv"><div class="k">Lifecycle</div><div class="v">${escapeHtml(c.lifecycle)}</div></div>
  `;

  const status = c.status || node.status || {};
  const cpdStatusFields = ["customerResearchData", "valuePropositionClarity", "pricingEconomicModel", "reliabilitySLO", "securityRiskPosture", "operationalOwnership"];
  
  // Store current node globally for document opening
  window.currentNode = node;
  
panelContent.innerHTML += `
    <h3 id="status-section-header">8. Status — Product Maturity Signals</h3>
    <p class="statusExplanation">CPDs carry responsibility and risk. The status fields below indicate where this product stands in its maturity journey. <strong>NONE</strong> means the field is consciously absent (early stage or not applicable yet). <strong>TBD</strong> means open work or a decision is pending. <strong>N/A</strong> means the field is structurally not applicable.</p>
    <p style="font-size: 11px; color: var(--muted); margin-top: 8px; margin-bottom: 12px;">💡 Click any status field to open/edit the CPD document in GitHub.</p>
    ${renderStatusTable(status, cpdStatusFields, "CPD", node)}
    
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line);">
      <button onclick="deleteNode(window.currentNode)" style="width: 100%; padding: 10px; background: rgba(255, 102, 122, 0.15); border: 1px solid rgba(255, 102, 122, 0.4); border-radius: 6px; color: var(--bad); cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='rgba(255, 102, 122, 0.25)'" onmouseout="this.style.background='rgba(255, 102, 122, 0.15)'">
        🗑️ Delete Node
      </button>
    </div>
  `;
}

function humanize(key) {
  const map = {
    "customerResearchData": "Customer Research Data",
    "valuePropositionClarity": "Value Proposition Clarity",
    "pricingEconomicModel": "Pricing / Economic Model",
    "reliabilitySLO": "Reliability SLO",
    "securityRiskPosture": "Security Risk Posture",
    "operationalOwnership": "Operational Ownership",
    "userAudienceEvidence": "User Audience Evidence",
    "problemDefinitionClarity": "Problem Definition Clarity",
    "adoptionEvidence": "Adoption Evidence",
    "productizationEligibility": "Productization Eligibility",
    "ownershipStatus": "Ownership Status",
    "standardizationRisk": "Standardization Risk"
  };
  return map[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, str => str.toUpperCase()).trim();
  }
  
  function statusClass(v) {
    const s = String(v).toUpperCase();
    if (s === "NONE") return "statusNone";
    if (s === "TBD") return "statusTbd";
    if (s.startsWith("N/A")) return "statusNa";
    return "";
  }

function renderStatusTable(status, requiredFields, nodeType = "CPD", node = null) {
  const statusObj = status || {};
  const html = requiredFields.map(field => {
    const value = statusObj[field] ?? "NONE";
    const norm = String(value);
    const cls = statusClass(norm);
    const fieldKey = field;
    // Make status field clickable to open document
    const clickHandler = node ? `onclick="window.openNodeDocument(window.currentNode, '${fieldKey}')"` : '';
    const cursorStyle = node ? 'cursor: pointer; text-decoration: underline; opacity: 0.9;' : '';
    const titleAttr = node ? `title="Click to open/edit ${node.type} document for ${humanize(fieldKey)}"` : '';
    return `<div class="k">${escapeHtml(humanize(field))}</div><div class="v ${cls}" data-field="${fieldKey}" ${clickHandler} style="${cursorStyle}" ${titleAttr}>${escapeHtml(norm)}</div>`;
  }).join("");
  return `<div class="kv" data-status-section="true">${html}</div>`;
}

function renderCCD(node) {
  const c = node.ccd;
  panelContent.innerHTML = `
    <h2><span class="badge ccd">CCD</span>${escapeHtml(node.name)}</h2>

    <h3>1. Concept Name</h3>
    <div class="kv"><div class="k">Name</div><div class="v">${escapeHtml(c.conceptName)}</div></div>

    <h3>2. What is this concept?</h3>
    <p>${escapeHtml(c.whatIs)}</p>

    <h3>3. What is this concept explicitly not?</h3>
    <ul>${c.whatIsNot.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

    <h3>4. Non-implicit decision</h3>
    <p><b>${escapeHtml(c.neverImplicit)}</b></p>

    <h3>5. Ownership</h3>
    <div class="kv">
      <div class="k">Concept Steward</div><div class="v">${escapeHtml(c.ownership.conceptSteward)}</div>
      <div class="k">Product Responsibility</div><div class="v">${escapeHtml(c.ownership.productResponsibility)}</div>
      <div class="k">Economic Responsibility</div><div class="v">${escapeHtml(c.ownership.economicResponsibility)}</div>
    </div>

    <h3>6. Relationship to Products</h3>
    <ul>${c.relationshipRules.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>

    <h3>7. Maturity</h3>
    <div class="kv"><div class="k">Maturity</div><div class="v">${escapeHtml(c.maturity)}</div></div>

    <h3>8. Status — Concept Maturity Signals</h3>
    <p class="statusExplanation">CCDs do not imply a product commitment. The status fields below indicate where this concept stands in its maturity journey. <strong>NONE</strong> means the field is consciously absent (early stage or not applicable yet). <strong>TBD</strong> means open work or a decision is pending. <strong>N/A</strong> means the field is structurally not applicable. These values are signals of maturity, not failure.</p>
    <p style="font-size: 11px; color: var(--muted); margin-top: 8px; margin-bottom: 12px;">💡 Click any status field to open/edit the CCD document in GitHub.</p>
    ${renderStatusTable(c.status || node.status || {}, ["userAudienceEvidence", "problemDefinitionClarity", "adoptionEvidence", "productizationEligibility", "ownershipStatus", "standardizationRisk"], "CCD", node)}
    
    <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line);">
      <button onclick="deleteNode(window.currentNode)" style="width: 100%; padding: 10px; background: rgba(255, 102, 122, 0.15); border: 1px solid rgba(255, 102, 122, 0.4); border-radius: 6px; color: var(--bad); cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;" onmouseover="this.style.background='rgba(255, 102, 122, 0.25)'" onmouseout="this.style.background='rgba(255, 102, 122, 0.15)'">
        🗑️ Delete Node
      </button>
    </div>
  `;
}

const CPD_STATUS_KEYS = ["customerResearchData", "valuePropositionClarity", "pricingEconomicModel", "reliabilitySLO", "securityRiskPosture", "operationalOwnership"];
const CCD_STATUS_KEYS = ["userAudienceEvidence", "problemDefinitionClarity", "adoptionEvidence", "productizationEligibility", "ownershipStatus", "standardizationRisk"];

function validateSystem(data) {
  const errors = [];
  const warnings = [];
  
  const byId = new Map(data.nodes.map(n => [n.id, n]));
  
  // Rule group A — Link invariants (NICPD)
  for (const l of data.links) {
    const sourceId = l.source?.id || l.source;
    const targetId = l.target?.id || l.target;
    const s = byId.get(sourceId);
    const t = byId.get(targetId);
    
    if (!s || !t) {
      errors.push(`Fix link: references unknown node ${JSON.stringify(l)}`);
      continue;
    }

    // A1: Allowed link types are ONLY: uses, inspired-by
    if (!RULES.allowedLinkTypes.has(l.type)) {
      errors.push(`Change link type from "${l.type}" to "uses" or "inspired-by" for ${s.name} → ${t.name}`);
    }
    
    // A2: depends-on must be rejected explicitly
    if (l.type === "depends-on") {
      errors.push(`Remove "depends-on" link between ${s.name} and ${t.name}. Use "uses" for optional relationships instead.`);
    }
    
    // A3: CPD→CPD links are allowed ONLY if type is uses
    if (s.type === "CPD" && t.type === "CPD" && l.type !== "uses") {
      errors.push(`Change link type to "uses" for ${s.name} → ${t.name}. CPDs can only have "uses" relationships with other CPDs.`);
    }

    // A4: inspired-by MUST NOT be CPD→CPD
    if (l.type === "inspired-by" && s.type === "CPD" && t.type === "CPD") {
      errors.push(`Change link type from "inspired-by" to "uses" for ${s.name} → ${t.name}. CPDs cannot be inspired by other CPDs.`);
    }
  }
  
  // Rule group B — Required status schema
  for (const node of data.nodes) {
    const status = node.status || (node.type === "CPD" ? node.cpd?.status : node.ccd?.status) || {};
    const requiredKeys = node.type === "CPD" ? CPD_STATUS_KEYS : CCD_STATUS_KEYS;
    const nodeType = node.type;
    const nodeName = node.name;
    
    // B1: Every CPD/CCD must have status object
    if (!node.status && !(node.type === "CPD" ? node.cpd?.status : node.ccd?.status)) {
      errors.push(`Add status fields to ${nodeType} "${nodeName}"`);
      continue;
    }
    
    // B2: Missing any key or empty/null values => ERROR
    const missingOrEmptyKeys = requiredKeys.filter(key => {
      return !(key in status) || status[key] === null || status[key] === "";
    });
    if (missingOrEmptyKeys.length > 0) {
      const missingKeys = requiredKeys.filter(key => !(key in status));
      const emptyKeys = requiredKeys.filter(key => key in status && (status[key] === null || status[key] === ""));
      
      if (missingKeys.length > 0) {
        const fieldNames = missingKeys.map(k => humanize(k)).join(", ");
        errors.push(`Set ${fieldNames} for ${nodeType} "${nodeName}"`);
      }
      if (emptyKeys.length > 0) {
        const fieldNames = emptyKeys.map(k => humanize(k)).join(", ");
        errors.push(`Fill in ${fieldNames} for ${nodeType} "${nodeName}" (currently empty)`);
      }
    }
    
    // B4: Extra keys => WARNING
    const allKeys = Object.keys(status);
    const extraKeys = allKeys.filter(key => !requiredKeys.includes(key));
    if (extraKeys.length > 0) {
      const fieldNames = extraKeys.map(k => humanize(k)).join(", ");
      warnings.push(`Remove ${fieldNames} from ${nodeType} "${nodeName}" (not part of ${nodeType} schema)`);
    }
  }
  
  // Rule group C — Category misuse checks
  for (const node of data.nodes) {
    const status = node.status || (node.type === "CPD" ? node.cpd?.status : node.ccd?.status) || {};
    const nodeName = node.name;
    
    if (node.type === "CCD") {
      // C1: CCD must NOT contain product-only claims
      if ("pricingEconomicModel" in status) {
        errors.push(`Remove "Pricing / Economic Model" from CCD "${nodeName}" (product-only field)`);
      }
      if ("reliabilitySLO" in status) {
        errors.push(`Remove "Reliability SLO" from CCD "${nodeName}" (product-only field)`);
      }
      if ("operationalOwnership" in status) {
        errors.push(`Remove "Operational Ownership" from CCD "${nodeName}" (product-only field)`);
      }
    }
    
    if (node.type === "CPD") {
      // C2: CPD must NOT contain CCD-only keys (WARNING)
      if ("productizationEligibility" in status) {
        warnings.push(`Remove "Productization Eligibility" from CPD "${nodeName}" (concept-only field)`);
      }
      if ("standardizationRisk" in status) {
        warnings.push(`Remove "Standardization Risk" from CPD "${nodeName}" (concept-only field)`);
      }
    }
  }
  
  // Rule group D — Risky maturity combinations (WARNINGS only)
  for (const node of data.nodes) {
    if (node.type !== "CPD") continue;
    
    const status = node.status || node.cpd?.status || {};
    const nodeName = node.name;
    
    // D1: CPD reliabilitySLO is not NONE AND operationalOwnership is NONE or TBD
    const reliabilitySLO = String(status.reliabilitySLO || "").toUpperCase();
    const operationalOwnership = String(status.operationalOwnership || "").toUpperCase();
    if (reliabilitySLO !== "NONE" && reliabilitySLO !== "" && (operationalOwnership === "NONE" || operationalOwnership === "TBD")) {
      warnings.push(`Define "Operational Ownership" for CPD "${nodeName}" before setting reliability promises`);
    }
    
    // D2: CPD pricingEconomicModel is not NONE AND securityRiskPosture is NONE or TBD
    const pricingEconomicModel = String(status.pricingEconomicModel || "").toUpperCase();
    const securityRiskPosture = String(status.securityRiskPosture || "").toUpperCase();
    if (pricingEconomicModel !== "NONE" && pricingEconomicModel !== "" && pricingEconomicModel !== "N/A" && (securityRiskPosture === "NONE" || securityRiskPosture === "TBD")) {
      warnings.push(`Define "Security Risk Posture" for CPD "${nodeName}" before setting pricing model`);
    }
  }
  
  for (const node of data.nodes) {
    if (node.type !== "CCD") continue;
    
    const status = node.status || node.ccd?.status || {};
    const nodeName = node.name;
    
    // D3: CCD productizationEligibility equals ELIGIBLE AND ownershipStatus equals NONE
    const productizationEligibility = String(status.productizationEligibility || "").toUpperCase();
    const ownershipStatus = String(status.ownershipStatus || "").toUpperCase();
    if (productizationEligibility === "ELIGIBLE" && ownershipStatus === "NONE") {
      warnings.push(`Assign "Ownership Status" to CCD "${nodeName}" since it's marked as productization-eligible`);
    }
  }
  
  return { errors, warnings };
}

function showIntro() {
  panelErrors.classList.remove("hidden");
  panelErrors.innerHTML = `
    <div style="line-height: 1.6;">
      <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 15px; color: var(--text);">About This Tool</h3>
      <p style="margin-bottom: 12px; font-size: 13px;">This dashboard visualizes ChainSafe's product system through <strong>CPDs</strong> (Canonical Product Definitions) and <strong>CCDs</strong> (Canonical Concept Definitions). Each node represents a product or concept with defined boundaries, ownership, and maturity status.</p>
      <p style="margin-bottom: 12px; font-size: 13px;"><strong>Why use it?</strong> This system makes product commitments explicit and prevents implicit dependencies. It helps teams understand what is a product (with responsibility and risk) versus what is a concept (exploratory, no commitment).</p>
      <p style="margin-bottom: 0; font-size: 13px;"><strong>How we think about products:</strong> At ChainSafe, products carry explicit ownership, decision authority, and maturity signals. Concepts can inspire products but don't create obligations. This framework ensures clarity, accountability, and intentional product development.</p>
    </div>
  `;
}

function hideIntro() {
  // Only hide if it's showing intro (not validation results)
  const currentContent = panelErrors.innerHTML;
  if (currentContent && currentContent.includes("About This Tool")) {
    panelErrors.classList.add("hidden");
    panelErrors.innerHTML = "";
  }
}

function showValidation(result) {
  hideIntro();
  const weekKey = getWeekKey();
  const acks = getAcknowledgedErrors(weekKey);
  
  // Handle legacy format (array of errors)
  if (Array.isArray(result)) {
    const errors = result;
    if (!errors || errors.length === 0) {
      panelErrors.classList.remove("hidden");
      panelErrors.innerHTML = `<div style="color: rgba(153, 255, 153, 0.8);">✅ No issues found.</div>`;
      renderRoutines();
    return;
  }
  panelErrors.classList.remove("hidden");
    window.currentValidationErrors = errors;
    panelErrors.innerHTML = `<b>Validation Errors</b><ul>${errors.map((e, idx) => {
      const msgHash = hashString(e);
      const ack = acks[msgHash];
      return `<li>${ack ? `<span style="color: var(--muted);">[ACK: ${escapeHtml(ack.reason || 'acknowledged')}]</span> ` : ''}${escapeHtml(e)}${!ack ? ` <button onclick="acknowledgeValidationMessage(${idx}, '${weekKey}')" style="margin-left: 6px; padding: 2px 6px; background: transparent; border: 1px solid var(--line); border-radius: 3px; color: var(--text); cursor: pointer; font-size: 10px;">Acknowledge</button>` : ''}</li>`;
    }).join("")}</ul>`;
    renderRoutines();
    return;
  }
  
  // Handle new format (object with errors and warnings)
  const { errors = [], warnings = [] } = result;
  
  if (errors.length === 0 && warnings.length === 0) {
    panelErrors.classList.remove("hidden");
    panelErrors.innerHTML = `<div style="color: rgba(153, 255, 153, 0.8);">✅ No issues found.</div>`;
    renderRoutines();
    return;
  }
  
  panelErrors.classList.remove("hidden");
  let html = `<b>Validation Results</b>`;
  
  if (errors.length > 0) {
    html += `<div style="margin-top: 8px;"><b>Errors (${errors.length})</b><ul style="margin-top: 4px;">${errors.map((e, idx) => {
      const msgHash = hashString(e);
      const ack = acks[msgHash];
      const safeMsg = e.replace(/'/g, "&#039;").replace(/"/g, "&quot;");
      return `<li>${ack ? `<span style="color: var(--muted);">[ACK: ${escapeHtml(ack.reason || 'acknowledged')}]</span> ` : ''}${escapeHtml(e)}${!ack ? ` <button onclick="acknowledgeValidationMessage(${idx}, '${weekKey}')" data-message="${escapeHtml(safeMsg)}" style="margin-left: 6px; padding: 2px 6px; background: transparent; border: 1px solid var(--line); border-radius: 3px; color: var(--text); cursor: pointer; font-size: 10px;">Acknowledge</button>` : ''}</li>`;
    }).join("")}</ul></div>`;
    // Store errors for acknowledgement
    window.currentValidationErrors = errors;
  }
  
  if (warnings.length > 0) {
    html += `<div style="margin-top: ${errors.length > 0 ? '12px' : '8px'};"><b>Warnings (${warnings.length})</b><ul style="margin-top: 4px;">${warnings.map(w => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`;
  }
  
  panelErrors.innerHTML = html;
  renderRoutines();
}

window.acknowledgeValidationMessage = function(errorIdx, weekKey) {
  if (!window.currentValidationErrors || !window.currentValidationErrors[errorIdx]) return;
  const message = window.currentValidationErrors[errorIdx];
  const reason = prompt("Reason for acknowledgement (optional, max 120 chars):", "");
  if (reason === null) return; // User cancelled
  
  const trimmedReason = reason.trim().substring(0, 120);
  acknowledgeError(message, trimmedReason, weekKey);
  
  // Re-run validation to update display
  if (data) {
    showValidation(validateSystem(data));
  }
};

function drag(sim) {
  function dragstarted(event, d) {
    if (!event.active) sim.alphaTarget(0.3).restart();
    d.fx = d.x; d.fy = d.y;
  }
  function dragged(event, d) {
    d.fx = event.x; d.fy = event.y;
  }
  function dragended(event, d) {
    if (!event.active) sim.alphaTarget(0);
    d.fx = null; d.fy = null;
  }
  return d3.drag().on("start", dragstarted).on("drag", dragged).on("end", dragended);
}

function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// Template and form creation system
let currentTemplateType = null;
let templateData = null;

async function showCreateForm() {
  // Show template selection
  document.querySelector(".panelEmpty")?.classList?.add("hidden");
  panelContent.classList.remove("hidden");
  hideIntro();
  
  panelContent.innerHTML = `
    <h2>Create New Node</h2>
    <p style="margin-bottom: 16px;">Choose a template to create a new CPD or CCD:</p>
    <div style="display: flex; gap: 12px; flex-direction: column;">
      <button class="templateBtn" data-type="CPD" style="padding: 12px; background: rgba(102, 204, 255, 0.1); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 8px; color: var(--text); cursor: pointer;">
        <strong>CPD - Canonical Product Definition</strong><br>
        <span style="font-size: 12px; color: var(--muted);">Create a new product</span>
      </button>
      <button class="templateBtn" data-type="CCD" style="padding: 12px; background: rgba(153, 255, 153, 0.1); border: 1px solid rgba(153, 255, 153, 0.4); border-radius: 8px; color: var(--text); cursor: pointer;">
        <strong>CCD - Canonical Concept Definition</strong><br>
        <span style="font-size: 12px; color: var(--muted);">Create a new concept</span>
      </button>
    </div>
  `;
  
  // Add event listeners
  document.querySelectorAll(".templateBtn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const type = e.currentTarget.dataset.type;
      await loadAndRenderTemplate(type);
    });
  });
}

async function loadAndRenderTemplate(type) {
  currentTemplateType = type;
  // Try multiple possible paths for GitHub Pages
  const possiblePaths = [
    `docs/templates/${type}_TEMPLATE.md`,
    `docs/tempates/${type}_TEMPLATE.md`, // Handle typo in directory name
    `/${type}_TEMPLATE.md`,
    `../docs/templates/${type}_TEMPLATE.md`,
    `../docs/tempates/${type}_TEMPLATE.md`
  ];
  
  let markdown = null;
  let lastError = null;
  
  for (const templatePath of possiblePaths) {
    try {
      const response = await fetch(templatePath);
      if (response.ok) {
        markdown = await response.text();
        break;
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }
  
  if (!markdown) {
    // If template loading fails, create form from known structure
    templateData = createDefaultTemplateData(type);
    renderTemplateForm(type, templateData);
    return;
  }
  
  try {
    templateData = parseTemplate(markdown, type);
    renderTemplateForm(type, templateData);
  } catch (error) {
    // Fallback to default template
    templateData = createDefaultTemplateData(type);
    renderTemplateForm(type, templateData);
  }
}

function createDefaultTemplateData(type) {
  return {
    type: type,
    fields: {
      name: "",
      whatIs: "",
      whatIsNot: [],
      neverImplicit: "",
      status: type === "CPD" ? {
        customerResearchData: "NONE",
        valuePropositionClarity: "TBD",
        pricingEconomicModel: "TBD",
        reliabilitySLO: "NONE",
        securityRiskPosture: "TBD",
        operationalOwnership: "TBD"
      } : {
        userAudienceEvidence: "NONE",
        problemDefinitionClarity: "TBD",
        adoptionEvidence: "NONE",
        productizationEligibility: "NOT ELIGIBLE",
        ownershipStatus: "NONE",
        standardizationRisk: "HIGH"
      }
    }
  };
}

function parseTemplate(markdown, type) {
  const data = {
    type: type,
    fields: {}
  };
  
  // Extract product/concept name
  const nameMatch = markdown.match(/\*\*Name:\*\*\s*`<([^>]+)>`/);
  if (nameMatch) data.fields.name = "";
  
  // Extract "what is" (paragraph after "## 2. What is")
  const whatIsMatch = markdown.match(/## 2\. What is this (product|concept)\?\s*`<([^>]+)>`/s);
  if (whatIsMatch) data.fields.whatIs = "";
  
  // Extract "what is not" (list items)
  const whatIsNotMatch = markdown.match(/## 3\. What is this (product|concept) explicitly not\?\s*((?:- `<[^>]+>`\s*)+)/s);
  if (whatIsNotMatch) {
    const items = whatIsNotMatch[2].match(/- `<([^>]+)>`/g) || [];
    data.fields.whatIsNot = items.map(item => item.match(/`<([^>]+)>`/)[1]).filter(t => t !== "NOT 1" && t !== "NOT 2");
  }
  
  // Extract neverImplicit
  const neverImplicitMatch = markdown.match(/## 4\. Decision that must never be implicit\s*> `<([^>]+)>`/s);
  if (neverImplicitMatch) data.fields.neverImplicit = "";
  
  // Extract ownership fields
  if (type === "CPD") {
    const ownerMatch = markdown.match(/- \*\*Product Owner:\*\* `<([^>]+)>`/);
    if (ownerMatch) data.fields.productOwner = "";
    const deliveryMatch = markdown.match(/- \*\*Delivery Owner:\*\* `<([^>]+)>`/);
    if (deliveryMatch) data.fields.deliveryOwner = "";
    const techMatch = markdown.match(/- \*\*Technical Authority:\*\* `<([^>]+)>`/);
    if (techMatch) data.fields.technicalAuthority = "";
  } else {
    const stewardMatch = markdown.match(/- \*\*Concept Steward:\*\* `<([^>]+)>`/);
    if (stewardMatch) data.fields.conceptSteward = "";
    data.fields.productResponsibility = "NONE";
    data.fields.economicResponsibility = "NONE";
  }
  
  // Extract decision level (CPD only)
  if (type === "CPD") {
    data.fields.implementation = "TEAM";
    data.fields.scopePriority = "OWNER";
    data.fields.lifecycleGoNoGo = "EXPLICIT_ONLY";
  }
  
  // Extract lifecycle/maturity
  if (type === "CPD") {
    const lifecycleMatch = markdown.match(/## 7\. Lifecycle\s*`<([^>]+)>`/);
    if (lifecycleMatch) data.fields.lifecycle = "";
  } else {
    const maturityMatch = markdown.match(/## 7\. Maturity\s*`<([^>]+)>`/);
    if (maturityMatch) data.fields.maturity = "";
  }
  
  // Extract status fields
  if (type === "CPD") {
    data.fields.status = {
      customerResearchData: "NONE",
      valuePropositionClarity: "TBD",
      pricingEconomicModel: "TBD",
      reliabilitySLO: "NONE",
      securityRiskPosture: "TBD",
      operationalOwnership: "TBD"
    };
  } else {
    data.fields.status = {
      userAudienceEvidence: "NONE",
      problemDefinitionClarity: "TBD",
      adoptionEvidence: "NONE",
      productizationEligibility: "NOT ELIGIBLE",
      ownershipStatus: "NONE",
      standardizationRisk: "HIGH"
    };
  }
  
  return data;
}

function renderTemplateForm(type, templateData) {
  const fields = templateData.fields;
  const statusFields = type === "CPD" ? CPD_STATUS_KEYS : CCD_STATUS_KEYS;
  
  let html = `
    <h2><span class="badge ${type.toLowerCase()}">${type}</span>Create New ${type === "CPD" ? "Product" : "Concept"}</h2>
    <form id="nodeForm" style="margin-top: 16px;">
  `;
  
  // Name
  html += `
    <h3>1. ${type === "CPD" ? "Product" : "Concept"} Name</h3>
    <input type="text" id="field-name" placeholder="Enter ${type === "CPD" ? "product" : "concept"} name" required 
           style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
  `;
  
  // What is
  html += `
    <h3>2. What is this ${type === "CPD" ? "product" : "concept"}?</h3>
    <textarea id="field-whatIs" rows="3" placeholder="One paragraph description" required
              style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px; resize: vertical;"></textarea>
  `;
  
  // What is not
  html += `
    <h3>3. What is this ${type === "CPD" ? "product" : "concept"} explicitly not?</h3>
    <div id="whatIsNot-list"></div>
    <button type="button" onclick="addWhatIsNotItem()" style="margin-top: 8px; padding: 6px 12px; background: transparent; border: 1px solid var(--line); color: var(--text); border-radius: 6px; cursor: pointer; font-size: 12px;">+ Add Item</button>
  `;
  
  // Never implicit
  html += `
    <h3>4. Decision that must never be implicit</h3>
    <textarea id="field-neverImplicit" rows="2" placeholder="Single most dangerous assumption" required
              style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px; resize: vertical;"></textarea>
  `;
  
  // Ownership
  html += `<h3>5. Ownership</h3>`;
  if (type === "CPD") {
    html += `
      <div style="display: grid; gap: 8px; margin-bottom: 8px;">
        <input type="text" id="field-productOwner" placeholder="Product Owner" required
               style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
        <input type="text" id="field-deliveryOwner" placeholder="Delivery Owner" required
               style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
        <input type="text" id="field-technicalAuthority" placeholder="Technical Authority" required
               style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
      </div>
    `;
  } else {
    html += `
      <div style="display: grid; gap: 8px; margin-bottom: 8px;">
        <input type="text" id="field-conceptSteward" placeholder="Concept Steward (or TBD)" 
               style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
      </div>
    `;
  }
  
  // Decision level (CPD only) or Relationship rules (CCD)
  if (type === "CPD") {
    html += `
      <h3>6. Decision Level</h3>
      <div style="display: grid; gap: 8px; margin-bottom: 8px;">
        <select id="field-implementation" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;">
          <option value="TEAM">Implementation: TEAM</option>
        </select>
        <select id="field-scopePriority" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;">
          <option value="OWNER">Scope/Priority: OWNER</option>
        </select>
        <select id="field-lifecycleGoNoGo" style="padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;">
          <option value="EXPLICIT_ONLY">Lifecycle/Go-No-Go: EXPLICIT_ONLY</option>
        </select>
      </div>
    `;
  } else {
    html += `
      <h3>6. Relationship Rules</h3>
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 8px;">These are fixed rules for CCDs:</p>
      <ul style="font-size: 12px; color: var(--muted);">
        <li>Products may use ideas from this concept.</li>
        <li>Products must not be defined by this concept.</li>
        <li>This concept may be influenced by product reality.</li>
        <li>This concept must not replace product decisions.</li>
      </ul>
    `;
  }
  
  // Lifecycle/Maturity
  if (type === "CPD") {
    html += `
      <h3>7. Lifecycle Stage</h3>
      <select id="field-lifecycle" required
              style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;">
        <option value="">Select lifecycle stage</option>
        <option value="Research / Pre-Product">Research / Pre-Product</option>
        <option value="Incubation / Enablement">Incubation / Enablement</option>
        <option value="Growth / Early Scale">Growth / Early Scale</option>
        <option value="Infrastructure / Maintenance">Infrastructure / Maintenance</option>
      </select>
    `;
  } else {
    html += `
      <h3>7. Maturity</h3>
      <select id="field-maturity" required
              style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;">
        <option value="">Select maturity</option>
        <option value="Concept / Folklore">Concept / Folklore</option>
        <option value="Concept (Validated)">Concept (Validated)</option>
        <option value="Proto-Standard (Draft)">Proto-Standard (Draft)</option>
      </select>
    `;
  }
  
  // Status fields
  html += `
    <h3>8. Status — ${type === "CPD" ? "Product" : "Concept"} Maturity Signals</h3>
    <p style="font-size: 12px; color: var(--muted); margin-bottom: 12px;">Set initial status values (NONE, TBD, N/A, or explicit description)</p>
  `;
  
  statusFields.forEach(field => {
    const humanized = humanize(field);
    html += `
      <div style="margin-bottom: 10px;">
        <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px;">${humanized}</label>
        <input type="text" id="status-${field}" value="${fields.status[field]}" 
               placeholder="NONE, TBD, N/A, or description"
               style="width: 100%; padding: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 12px;" />
      </div>
    `;
  });
  
  // Form buttons
  html += `
      <div style="margin-top: 20px; display: flex; gap: 8px; flex-wrap: wrap;">
        <button type="submit" style="flex: 1; padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 6px; color: var(--text); cursor: pointer; font-weight: 600;">Generate JSON</button>
        <button type="button" onclick="showCreateForm()" style="padding: 10px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--text); cursor: pointer;">Cancel</button>
      </div>
    </form>
  `;
  
  panelContent.innerHTML = html;
  
  // Initialize whatIsNot list (start with 1 empty field)
  window.whatIsNotCount = 1;
  setTimeout(() => {
    window.updateWhatIsNotList();
    // Form submit handler
    document.getElementById("nodeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      generateAndExportJSON(type);
    });
  }, 0);
}

// Make functions globally accessible
window.addWhatIsNotItem = function() {
  window.whatIsNotCount = (window.whatIsNotCount || 0) + 1;
  updateWhatIsNotList();
};

window.updateWhatIsNotList = function() {
  const container = document.getElementById("whatIsNot-list");
  if (!container) return;
  
  let html = "";
  const count = window.whatIsNotCount || 1;
  for (let i = 0; i < count; i++) {
    html += `
      <input type="text" id="whatIsNot-${i}" placeholder="Not ${i + 1}" 
             style="width: 100%; padding: 6px; margin-bottom: 6px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 12px;" />
    `;
  }
  container.innerHTML = html;
};

function generateAndExportJSON(type) {
  const form = document.getElementById("nodeForm");
  const formData = new FormData(form);
  
  // Collect whatIsNot items
  const whatIsNot = [];
  for (let i = 0; i < (window.whatIsNotCount || 1); i++) {
    const input = document.getElementById(`whatIsNot-${i}`);
    if (input && input.value.trim()) {
      whatIsNot.push(input.value.trim());
    }
  }
  
  // Collect status fields
  const statusFields = type === "CPD" ? CPD_STATUS_KEYS : CCD_STATUS_KEYS;
  const status = {};
  statusFields.forEach(field => {
    const input = document.getElementById(`status-${field}`);
    status[field] = input ? input.value.trim() || "NONE" : "NONE";
  });
  
  // Build node object
  const nodeId = `cpd-${document.getElementById("field-name").value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/^-|-$/g, "") || 
                 `ccd-${document.getElementById("field-name").value.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`.replace(/-+/g, "-").replace(/^-|-$/g, "");
  
  let node;
  if (type === "CPD") {
    node = {
      id: nodeId,
      type: "CPD",
      name: document.getElementById("field-name").value.trim(),
      cpd: {
        productName: document.getElementById("field-name").value.trim(),
        whatIs: document.getElementById("field-whatIs").value.trim(),
        whatIsNot: whatIsNot,
        neverImplicit: document.getElementById("field-neverImplicit").value.trim(),
        ownership: {
          productOwner: document.getElementById("field-productOwner").value.trim(),
          deliveryOwner: document.getElementById("field-deliveryOwner").value.trim(),
          technicalAuthority: document.getElementById("field-technicalAuthority").value.trim()
        },
        decisionLevel: {
          implementation: document.getElementById("field-implementation").value,
          scopePriority: document.getElementById("field-scopePriority").value,
          lifecycleGoNoGo: document.getElementById("field-lifecycleGoNoGo").value
        },
        lifecycle: document.getElementById("field-lifecycle").value,
        status: status
      }
    };
  } else {
    node = {
      id: nodeId,
      type: "CCD",
      name: document.getElementById("field-name").value.trim(),
      ccd: {
        conceptName: document.getElementById("field-name").value.trim(),
        whatIs: document.getElementById("field-whatIs").value.trim(),
        whatIsNot: whatIsNot,
        neverImplicit: document.getElementById("field-neverImplicit").value.trim(),
        ownership: {
          conceptSteward: document.getElementById("field-conceptSteward")?.value.trim() || "TBD",
          productResponsibility: "NONE",
          economicResponsibility: "NONE"
        },
        relationshipRules: [
          "Products may use ideas from this concept.",
          "Products must not be defined by this concept.",
          "This concept may be influenced by product reality.",
          "This concept must not replace product decisions."
        ],
        maturity: document.getElementById("field-maturity").value,
        status: status
      }
    };
  }
  
  // Show export options
  showExportOptions(node);
}

function cleanDataForExport(dataObj) {
  // Clean nodes - remove any D3-added properties
  const cleanNodes = dataObj.nodes.map(n => {
    const clean = {
      id: n.id,
      type: n.type,
      name: n.name
    };
    if (n.cpd) clean.cpd = JSON.parse(JSON.stringify(n.cpd));
    if (n.ccd) clean.ccd = JSON.parse(JSON.stringify(n.ccd));
    if (n.status) clean.status = JSON.parse(JSON.stringify(n.status));
    return clean;
  });
  
  // Clean links - extract only source, target, type (remove D3 circular refs)
  const cleanLinks = dataObj.links.map(l => {
    const sourceId = typeof l.source === 'object' && l.source.id ? l.source.id : l.source;
    const targetId = typeof l.target === 'object' && l.target.id ? l.target.id : l.target;
    return {
      source: sourceId,
      target: targetId,
      type: l.type
    };
  });
  
  return { nodes: cleanNodes, links: cleanLinks };
}

function getGitHubRepoInfo() {
  // Try to detect from current URL (GitHub Pages format: owner.github.io/repo)
  const hostname = window.location.hostname;
  const pathname = window.location.pathname;
  
  // For GitHub Pages: owner.github.io/repo or owner.github.io
  if (hostname.includes('github.io')) {
    const parts = hostname.split('.');
    if (parts.length >= 3) {
      const owner = parts[0];
      const repo = pathname.split('/')[1] || 'capability-system';
      return { owner, repo };
    }
  }
  
  // Fallback: try to get from localStorage or prompt
  const stored = localStorage.getItem('githubRepo');
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {}
  }
  
  return null;
}

function showExportOptions(node) {
  const jsonString = JSON.stringify(node, null, 2);
  const cleanedData = cleanDataForExport({ nodes: [...data.nodes, node], links: data.links });
  const fullDataJson = JSON.stringify(cleanedData, null, 2);
  const repoInfo = getGitHubRepoInfo();
  const hasGitHubToken = localStorage.getItem('githubToken');
  
  panelContent.innerHTML = `
    <h2>✅ Node Generated</h2>
    <p style="margin-bottom: 16px;">Your ${node.type} has been generated. Choose an export option:</p>
    
    <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;">
      ${hasGitHubToken && repoInfo ? `
      <button onclick="commitToGitHub()" style="padding: 10px; background: rgba(102, 204, 255, 0.3); border: 2px solid rgba(102, 204, 255, 0.6); border-radius: 6px; color: var(--text); cursor: pointer; font-weight: 600;">
        🚀 Commit to GitHub
      </button>
      ` : `
      <button onclick="setupGitHubAuth()" style="padding: 10px; background: rgba(255, 204, 102, 0.2); border: 1px solid rgba(255, 204, 102, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">
        ⚙️ Setup GitHub Integration
      </button>
      `}
      <button onclick="downloadNodeJSON()" style="padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">
        📥 Download Node JSON
      </button>
      <button onclick="copyNodeJSON()" style="padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">
        📋 Copy Node JSON to Clipboard
      </button>
      <button onclick="downloadFullDataJson()" style="padding: 10px; background: rgba(153, 255, 153, 0.2); border: 1px solid rgba(153, 255, 153, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">
        📥 Download Full data.json (with new node)
      </button>
    </div>
    
    <details style="margin-top: 16px;">
      <summary style="cursor: pointer; color: var(--muted); font-size: 12px;">Preview JSON</summary>
      <pre style="margin-top: 8px; padding: 12px; background: rgba(0,0,0,0.3); border-radius: 6px; overflow-x: auto; font-size: 11px; line-height: 1.4;">${escapeHtml(jsonString)}</pre>
    </details>
    
    ${!hasGitHubToken ? `
    <div style="margin-top: 16px; padding: 12px; background: rgba(255, 204, 102, 0.1); border-left: 3px solid var(--warn); border-radius: 6px;">
      <p style="font-size: 12px; margin: 0;"><strong>Next steps:</strong></p>
      <ol style="font-size: 12px; margin: 8px 0 0 18px; padding: 0;">
        <li>Download or copy the JSON</li>
        <li>Add the node to <code>public/data.json</code> in the <code>nodes</code> array</li>
        <li>Commit and push to GitHub</li>
        <li>The new node will appear in the graph after deployment</li>
      </ol>
    </div>
    ` : ''}
    
    <button onclick="showCreateForm()" style="margin-top: 16px; padding: 8px 12px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--text); cursor: pointer;">Create Another</button>
  `;
  
  // Store node data globally for download/copy functions
  window.generatedNode = node;
  window.generatedFullData = cleanedData;
}

window.setupGitHubAuth = function() {
  const repoInfo = getGitHubRepoInfo();
  const currentOwner = repoInfo?.owner || '';
  const currentRepo = repoInfo?.repo || 'capability-system';
  
  panelContent.innerHTML = `
    <h2>⚙️ GitHub Integration Setup</h2>
    <p style="margin-bottom: 16px; font-size: 13px;">To commit directly from the UI, you need a GitHub Personal Access Token with <code>repo</code> scope.</p>
    
    <form id="githubSetupForm" style="display: flex; flex-direction: column; gap: 12px;">
      <div>
        <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px;">Repository Owner</label>
        <input type="text" id="githubOwner" value="${currentOwner}" placeholder="your-username" required
               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
      </div>
      <div>
        <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px;">Repository Name</label>
        <input type="text" id="githubRepo" value="${currentRepo}" placeholder="capability-system" required
               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
      </div>
      <div>
        <label style="display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px;">GitHub Personal Access Token</label>
        <input type="password" id="githubToken" placeholder="ghp_..." required
               style="width: 100%; padding: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--line); border-radius: 6px; color: var(--text); font-size: 13px;" />
        <p style="font-size: 11px; color: var(--muted); margin-top: 4px;">
          Create one at: <a href="https://github.com/settings/tokens" target="_blank" style="color: rgba(102, 204, 255, 0.8);">github.com/settings/tokens</a><br>
          Required scope: <code>Contents</code> (Read and write)
        </p>
      </div>
      <div style="display: flex; gap: 8px;">
        <button type="submit" style="flex: 1; padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">Save & Test</button>
        <button type="button" onclick="showExportOptions(window.generatedNode)" style="padding: 10px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--text); cursor: pointer;">Cancel</button>
      </div>
    </form>
    
    <div style="margin-top: 16px; padding: 12px; background: rgba(255, 102, 122, 0.1); border-left: 3px solid var(--bad); border-radius: 6px;">
      <p style="font-size: 11px; margin: 0; color: var(--muted);">
        <strong>⚠️ Security Note:</strong> Your token is stored in browser localStorage. Only use this on trusted devices. 
        You can clear it anytime by clearing browser data for this site.
      </p>
    </div>
  `;
  
  document.getElementById("githubSetupForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const owner = document.getElementById("githubOwner").value.trim();
    const repo = document.getElementById("githubRepo").value.trim();
    const token = document.getElementById("githubToken").value.trim();
    
    if (!owner || !repo || !token) {
      alert("Please fill in all fields");
      return;
    }
    
    // Test the token by making a simple API call
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      
      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid token. Please check your Personal Access Token.");
        } else if (response.status === 404) {
          throw new Error("Repository not found. Check owner and repo name.");
        }
        throw new Error(`GitHub API error: ${response.statusText}`);
      }
      
      // Save credentials
      localStorage.setItem('githubToken', token);
      localStorage.setItem('githubRepo', JSON.stringify({ owner, repo }));
      
      alert("✅ GitHub integration configured successfully!");
      showExportOptions(window.generatedNode);
    } catch (error) {
      alert(`❌ Setup failed: ${error.message}`);
    }
  });
};

// Helper function to commit with automatic retry on SHA conflicts
async function commitWithRetry(owner, repo, token, branch, updateFn, commitMessage, maxRetries = 3) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Always fetch the latest file to get current SHA
    const getFileResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/public/data.json`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!getFileResponse.ok) {
      throw new Error(`Failed to get data.json: ${getFileResponse.statusText}`);
    }
    
    const fileData = await getFileResponse.json();
    const decodedContent = atob(fileData.content.replace(/\n/g, '').replace(/\r/g, ''));
    const currentContent = JSON.parse(decodedContent);
    
    // Apply the update function (add node, remove node, etc.)
    const updatedContent = updateFn(currentContent);
    const newContent = JSON.stringify(updatedContent, null, 2);
    
    // Try to commit
    const commitResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/public/data.json`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: btoa(unescape(encodeURIComponent(newContent))),
        sha: fileData.sha, // Use the latest SHA we just fetched
        branch: branch
      })
    });
    
    if (commitResponse.ok) {
      return await commitResponse.json();
    }
    
    // If it failed, check if it's a SHA conflict
    const error = await commitResponse.json();
    if (error.message && error.message.includes('sha') && attempt < maxRetries - 1) {
      // SHA conflict - wait a bit and retry (will fetch latest SHA on next iteration)
      await new Promise(resolve => setTimeout(resolve, 500));
      continue;
    }
    
    // Other error or max retries reached
    throw new Error(error.message || `Commit failed: ${commitResponse.statusText}`);
  }
}

window.deleteNode = async function(node) {
  if (!node || !node.id) {
    alert("No node selected.");
    return;
  }
  
  // Confirmation
  const confirmed = confirm(`Are you sure you want to delete "${node.name}" (${node.type})?\n\nThis will:\n- Remove the node from the graph\n- Remove all links connected to this node\n- Update data.json in GitHub\n\nThis action cannot be undone.`);
  if (!confirmed) return;
  
  const token = localStorage.getItem('githubToken');
  const repoStr = localStorage.getItem('githubRepo');
  
  if (!token || !repoStr) {
    alert("GitHub integration not configured. Please set it up first (Create New → Commit to GitHub).");
    return;
  }
  
  const { owner, repo } = JSON.parse(repoStr);
  
  // Optimistic update: Remove from local data immediately
  const nodeIndex = data.nodes.findIndex(n => n.id === node.id);
  const originalNodes = [...data.nodes];
  const originalLinks = [...data.links];
  
  if (nodeIndex !== -1) {
    data.nodes.splice(nodeIndex, 1);
  }
  
  // Remove all links referencing this node
  data.links = data.links.filter(link => {
    const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
    const targetId = typeof link.target === 'object' ? link.target.id : link.target;
    return sourceId !== node.id && targetId !== node.id;
  });
  
  // Hide panel immediately
  panelContent.classList.add("hidden");
  document.querySelector(".panelEmpty")?.classList?.remove("hidden");
  
  // Stop old simulation if it exists
  if (simulation) {
    simulation.stop();
  }
  
  // Re-initialize graph completely for immediate visual update
  initGraph();
  render();
  
  // Hide panel immediately
  panelContent.classList.add("hidden");
  document.querySelector(".panelEmpty")?.classList?.remove("hidden");
  
  // Show loading state
  panelErrors.classList.remove("hidden");
  panelErrors.innerHTML = `
    <div style="color: var(--muted);">
      <strong>🗑️ Deleting node...</strong><br>
      Updating data.json in GitHub...
    </div>
  `;
  
  // Use requestAnimationFrame to ensure UI updates before async work
  requestAnimationFrame(() => {
    // Then use setTimeout to let the browser paint
    setTimeout(async () => {
    try {
      // Detect default branch
      let branch = 'main';
      try {
        const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
          headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json'
          }
        });
        if (repoResponse.ok) {
          const repoInfo = await repoResponse.json();
          branch = repoInfo.default_branch || 'main';
        }
      } catch (e) {
        // Fallback to 'main'
      }
      
      // Use retry helper to always work with latest file
      const commitResult = await commitWithRetry(
        owner,
        repo,
        token,
        branch,
        (currentContent) => {
          // Remove node
          currentContent.nodes = currentContent.nodes.filter(n => n.id !== node.id);
          // Remove all links referencing this node
          currentContent.links = currentContent.links.filter(link => {
            const sourceId = typeof link.source === 'string' ? link.source : (link.source?.id || link.source);
            const targetId = typeof link.target === 'string' ? link.target : (link.target?.id || link.target);
            return sourceId !== node.id && targetId !== node.id;
          });
          return currentContent;
        },
        `Delete ${node.type}: ${node.name}`
      );
    
    // Success!
    panelErrors.innerHTML = `
      <div style="color: rgba(153, 255, 153, 0.9);">
        <strong>✅ Node deleted successfully!</strong><br>
        <span style="font-size: 11px; color: var(--muted);">
          Commit: <a href="${commitResult.commit.html_url}" target="_blank" style="color: rgba(102, 204, 255, 0.8);">${commitResult.commit.sha.substring(0, 7)}</a><br>
          The graph will update after the site rebuilds (usually within a minute).
        </span>
      </div>
    `;
    
    // Re-render routines (tasks may have changed)
    renderRoutines();
      
    } catch (error) {
      // Revert optimistic update on error
      data.nodes = originalNodes;
      data.links = originalLinks;
      initGraph();
      render();
      
      panelErrors.innerHTML = `
        <div style="color: var(--bad);">
          <strong>❌ Delete failed</strong><br>
          <span style="font-size: 11px;">${escapeHtml(error.message)}</span><br>
          <span style="font-size: 11px; color: var(--muted);">The node has been restored in the graph.</span>
        </div>
      `;
    }
    }, 0);
  });
};


window.commitToGitHub = async function() {
  const token = localStorage.getItem('githubToken');
  const repoStr = localStorage.getItem('githubRepo');
  
  if (!token || !repoStr) {
    setupGitHubAuth();
    return;
  }
  
  const { owner, repo } = JSON.parse(repoStr);
  const node = window.generatedNode;
  const fullData = window.generatedFullData;
  
  // Show loading state
  const originalContent = panelContent.innerHTML;
  panelContent.innerHTML = `
    <h2>🚀 Committing to GitHub...</h2>
    <p style="color: var(--muted);">Updating data.json with new ${node.type}...</p>
    <div style="margin-top: 16px; padding: 12px; background: rgba(102, 204, 255, 0.1); border-radius: 6px;">
      <p style="font-size: 12px; margin: 0;">This may take a few seconds...</p>
    </div>
  `;
  
  try {
    // Detect default branch
    let branch = 'main';
    try {
      const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (repoResponse.ok) {
        const repoInfo = await repoResponse.json();
        branch = repoInfo.default_branch || 'main';
      }
    } catch (e) {
      // Fallback to 'main'
    }
    
    // Use retry helper to always work with latest file
    const commitResult = await commitWithRetry(
      owner,
      repo,
      token,
      branch,
      (currentContent) => {
        // Add new node (check if it already exists to avoid duplicates)
        const existingIndex = currentContent.nodes.findIndex(n => n.id === node.id);
        if (existingIndex !== -1) {
          currentContent.nodes[existingIndex] = node; // Update if exists
        } else {
          currentContent.nodes.push(node); // Add if new
        }
        return currentContent;
      },
      `Add new ${node.type}: ${node.name}`
    );
    
    // Success!
    panelContent.innerHTML = `
      <h2>✅ Successfully Committed!</h2>
      <p style="margin-bottom: 16px;">Your ${node.type} "${node.name}" has been added to the repository.</p>
      
      <div style="padding: 12px; background: rgba(153, 255, 153, 0.1); border-left: 3px solid rgba(153, 255, 153, 0.6); border-radius: 6px; margin-bottom: 16px;">
        <p style="font-size: 12px; margin: 0;">
          <strong>Commit:</strong> <a href="${commitResult.commit.html_url}" target="_blank" style="color: rgba(102, 204, 255, 0.8);">${commitResult.commit.sha.substring(0, 7)}</a><br>
          <strong>Message:</strong> ${escapeHtml(commitMessage)}
        </p>
      </div>
      
      <p style="font-size: 12px; color: var(--muted); margin-bottom: 16px;">
        The new node will appear in the graph after GitHub Pages rebuilds (usually within a minute).
      </p>
      
      <button onclick="showCreateForm()" style="padding: 10px; background: rgba(102, 204, 255, 0.2); border: 1px solid rgba(102, 204, 255, 0.4); border-radius: 6px; color: var(--text); cursor: pointer;">Create Another</button>
    `;
  } catch (error) {
    panelContent.innerHTML = `
      <h2>❌ Commit Failed</h2>
      <p style="color: var(--bad); margin-bottom: 16px;">${escapeHtml(error.message)}</p>
      <button onclick="showExportOptions(window.generatedNode)" style="padding: 10px; background: transparent; border: 1px solid var(--line); border-radius: 6px; color: var(--text); cursor: pointer;">Go Back</button>
    `;
  }
};

window.downloadNodeJSON = function() {
  const blob = new Blob([JSON.stringify(window.generatedNode, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${window.generatedNode.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
};

window.copyNodeJSON = function() {
  navigator.clipboard.writeText(JSON.stringify(window.generatedNode, null, 2)).then(() => {
    alert("✅ Node JSON copied to clipboard!");
  });
};

window.downloadFullDataJson = function() {
  const blob = new Blob([JSON.stringify(window.generatedFullData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "data.json";
  a.click();
  URL.revokeObjectURL(url);
};

load();

