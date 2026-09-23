const STOPWORDS = new Set(["how","to","for","the","a","an","of","in","on","my","your","this","that","and","or","vs","is","are","what","which","with"]);

const MODIFIER_TYPES = {
  commercial: ["best","top","review","alternative","pricing","price","cost"],
  transactional: ["buy","purchase","discount","deal"],
  informational: ["how","why","what","guide","tutorial"],
  attribute: ["free","cheap","enterprise"],
};

const SYNONYM_GROUPS = [
  ["software", "tool", "tools", "platform", "application", "app"],
  ["checker", "analyzer"],
];
const synonymGroupOf = new Map();
SYNONYM_GROUPS.forEach((group, gi) => group.forEach((w) => synonymGroupOf.set(w, gi)));

function normalizeWord(w) {
  if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

function classifyAndTokenize(keyword) {
  const words = keyword.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const modifiers = new Set();
  const coreTokens = [];
  for (const raw of words) {
    if (STOPWORDS.has(raw)) continue;
    const w = normalizeWord(raw);
    let matchedModifier = null;
    for (const [type, list] of Object.entries(MODIFIER_TYPES)) {
      if (list.includes(w) || list.includes(raw)) matchedModifier = type;
    }
    if (matchedModifier) {
      modifiers.add(matchedModifier);
      continue;
    }
    coreTokens.push(w);
  }
  return { original: keyword, coreTokens, modifiers: [...modifiers] };
}

function computeIDF(tokenSets) {
  const N = tokenSets.length;
  const docFreq = new Map();
  tokenSets.forEach((tokens) => new Set(tokens).forEach((t) => {
    docFreq.set(t, (docFreq.get(t) || 0) + 1);
  }));
  const idf = new Map();
  for (const [token, df] of docFreq) {
    idf.set(token, Math.log((N + 1) / (df + 1)) + 1);
  }
  return idf;
}

function similarity(a, b, idf) {
  const setA = new Set(a);
  const setB = new Set(b);
  const weightOf = (t) => idf.get(t) || 1;
  const exactInter = [...setA].filter((x) => setB.has(x));

  let interWeight = 0;
  let totalA = 0;
  let totalB = 0;
  for (const t of setA) totalA += weightOf(t);
  for (const t of setB) totalB += weightOf(t);
  for (const t of exactInter) interWeight += weightOf(t);
  const unionWeight = totalA + totalB - interWeight;
  const baseSimilarity = unionWeight === 0 ? 0 : interWeight / unionWeight;

  const groupsA = new Set([...setA].map((w) => synonymGroupOf.get(w)).filter((g) => g !== undefined));
  const groupsB = new Set([...setB].map((w) => synonymGroupOf.get(w)).filter((g) => g !== undefined));
  const sharedSynonymGroups = [...groupsA].filter(
    (g) => groupsB.has(g) && !exactInter.some((w) => synonymGroupOf.get(w) === g)
  );
  const synonymBonus = sharedSynonymGroups.length * 0.15;

  return Math.min(1, baseSimilarity + synonymBonus);
}

function buildCandidatePairs(tokenSets) {
  const index = new Map();
  tokenSets.forEach((tokens, i) => tokens.forEach((t) => {
    if (!index.has(t)) index.set(t, []);
    index.get(t).push(i);
  }));
  const seen = new Set();
  const pairs = [];
  for (const ids of index.values()) {
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const key = ids[a] < ids[b] ? \`\${ids[a]},\${ids[b]}\` : \`\${ids[b]},\${ids[a]}\`;
        if (!seen.has(key)) {
          seen.add(key);
          pairs.push([ids[a], ids[b]]);
        }
      }
    }
  }
  return pairs;
}

function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  }
  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }
  return { find, union };
}

const $ = (id) => document.getElementById(id);
const input = $("keywordInput");
const mode = $("clusterMode");
const custom = $("customThreshold");
const customWrap = $("customThresholdWrap");
const customValue = $("customThresholdValue");
const results = $("clusterResults");
const summary = $("clusterSummary");
const limit = $("keywordLimit");
const csvBtn = $("exportCsv");
const mdBtn = $("exportMarkdown");

let state = {
  clusters: [],
  orphans: [],
  threshold: 0.5,
  idf: new Map(),
};

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
}[c]));

function currentThreshold() {
  return mode.value === "custom" ? Number(custom.value) : Number(mode.value);
}

function getKeywords() {
  const raw = input.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const unique = [...new Set(raw)];
  if (raw.length > 1000) {
    limit.textContent = \`\${raw.length} lines entered. Only the first 1000 unique keywords are processed.\`;
  } else {
    limit.textContent = \`\${unique.length} unique keyword\${unique.length === 1 ? "" : "s"} ready. Maximum 1000.\`;
  }
  return unique.slice(0, 1000);
}

function build() {
  state.threshold = currentThreshold();
  const keys = getKeywords();
  if (!keys.length) {
    state = { clusters: [], orphans: [], threshold: state.threshold, idf: new Map() };
    render();
    return;
  }

  const data = keys.map(classifyAndTokenize);
  const idf = computeIDF(data.map((x) => x.coreTokens));
  const pairs = buildCandidatePairs(data.map((x) => x.coreTokens));
  const uf = makeUnionFind(data.length);

  for (const [a, b] of pairs) {
    if (similarity(data[a].coreTokens, data[b].coreTokens, idf) >= state.threshold) {
      uf.union(a, b);
    }
  }

  const groups = new Map();
  data.forEach((d, i) => {
    const root = uf.find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  });

  const clusters = [...groups.values()].map((ids, index) => {
    const members = ids.map((i) => data[i]);
    let primaryIndex = 0;
    let bestAverage = -1;

    for (let i = 0; i < members.length; i++) {
      let average = 0;
      if (members.length > 1) {
        for (let j = 0; j < members.length; j++) {
          if (i !== j) {
            average += similarity(members[i].coreTokens, members[j].coreTokens, idf);
          }
        }
        average /= members.length - 1;
      } else {
        average = 1;
      }

      if (
        average > bestAverage ||
        (average === bestAverage && members[i].original.length < members[primaryIndex].original.length)
      ) {
        bestAverage = average;
        primaryIndex = i;
      }
    }

    let total = 0;
    let count = 0;
    for (let a = 0; a < members.length; a++) {
      for (let b = a + 1; b < members.length; b++) {
        total += similarity(members[a].coreTokens, members[b].coreTokens, idf);
        count++;
      }
    }

    return {
      id: index + 1,
      members,
      primaryIndex,
      cohesion: count ? total / count : 1,
      modifiers: [...new Set(members.flatMap((m) => m.modifiers))],
    };
  });

  state.idf = idf;
  state.clusters = clusters.filter((c) => c.members.length > 1);
  state.orphans = clusters.filter((c) => c.members.length === 1).map((c) => c.members[0]);
  render();
}

function modifierLabel(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function moveOptions(currentId) {
  return state.clusters
    .filter((c) => c.id !== currentId)
    .map((c) => \`<option value="\${c.id}">Cluster \${c.id}</option>\`)
    .join("");
}

function renderMemberControls(clusterId, memberIndex) {
  return \`
    <select class="move-select" aria-label="Move keyword to another cluster" data-c="\${clusterId}" data-i="\${memberIndex}">
      <option value="">Move to…</option>
      \${moveOptions(clusterId)}
    </select>
    <button type="button" class="move-keyword" data-c="\${clusterId}" data-i="\${memberIndex}">Move</button>
    <button type="button" class="remove-keyword" data-c="\${clusterId}" data-i="\${memberIndex}">Remove</button>
  \`;
}

function render() {
  const real = state.clusters;
  let html = real.map((c) => {
    const primary = c.members[c.primaryIndex];
    const shared = [...new Set(c.members.flatMap((x) => x.coreTokens))].filter(
      (token) => c.members.every((x) => x.coreTokens.includes(token))
    );
    const tags = c.modifiers.length
      ? c.modifiers.map((m) => \`<span class="tag">\${esc(modifierLabel(m))}</span>\`).join(" ")
      : '<span class="cluster-muted">No pattern-based modifier signal</span>';
    const opts = c.members.map((m, i) =>
      \`<option value="\${i}" \${i === c.primaryIndex ? "selected" : ""}>\${esc(m.original)}</option>\`
    ).join("");

    const supporting = c.members.map((m, i) => {
      if (i === c.primaryIndex) return "";
      return \`
        <li>
          <span>\${esc(m.original)}</span>
          <span class="cluster-actions">\${renderMemberControls(c.id, i)}</span>
        </li>
      \`;
    }).join("");

    const cohesion = Math.round(c.cohesion * 100);
    const reason = shared.length
      ? \`Shared core terms: \${shared.map((x) => esc(x)).join(", ")}\`
      : "Related lexical terms across members.";

    return \`
      <article class="cluster-card panel">
        <div class="cluster-head">
          <div>
            <span class="cluster-label">Cluster \${c.id}</span>
            <h2>\${esc(primary.original)}</h2>
          </div>
          <label>Primary
            <select class="primary-select" data-c="\${c.id}">\${opts}</select>
          </label>

          <span class="cluster-actions">\${renderMemberControls(c.id, c.primaryIndex)}</span>
        </div>
        <div class="cluster-tags">\${tags}</div>
        <p class="cohesion">Cohesion \${cohesion}% <span class="bar"><span style="width:\${cohesion}%"></span></span></p>
        <p class="cluster-reason">\${reason}</p>
        <ul>\${supporting}</ul>
      </article>
    \`;
  }).join("");

  const warnings = [];
  for (let a = 0; a < real.length; a++) {
    for (let b = a + 1; b < real.length; b++) {
      const x = real[a].members[real[a].primaryIndex];
      const y = real[b].members[real[b].primaryIndex];
      const score = similarity(x.coreTokens, y.coreTokens, state.idf);
      if (score >= 0.35) {
        warnings.push(\`
          <div class="warning">
            These clusters may overlap — consider merging or differentiating them:
            <strong>\${esc(x.original)}</strong> ↔ <strong>\${esc(y.original)}</strong>
            (\${score.toFixed(2)})
          </div>
        \`);
      }
    }
  }

  if (warnings.length) {
    html = \`<section class="cluster-warnings"><h2>Cannibalization warnings</h2>\${warnings.join("")}</section>\` + html;
  }

  if (state.orphans.length) {
    const orphanItems = state.orphans.map((m, i) => \`
      <li>
        <span>\${esc(m.original)}</span>
        <span class="cluster-actions">
          <select class="orphan-target" data-i="\${i}" aria-label="Move orphan to a cluster">
            <option value="">Move to…</option>
            \${state.clusters.map((c) => \`<option value="\${c.id}">Cluster \${c.id}</option>\`).join("")}
          </select>
          <button type="button" class="move-orphan" data-i="\${i}">Move</button>
        </span>
      </li>
    \`).join("");

    html += \`
      <section class="panel orphan-panel">
        <h2>Orphans</h2>
        <p>No strong lexical match found. Review these separately or move one into a cluster if your subject knowledge supports it.</p>
        <ul>\${orphanItems}</ul>
      </section>
    \`;
  }

  results.innerHTML = html || '<p class="tool-note">Paste keywords above to build a content map.</p>';
  summary.textContent =
    \`\${real.length} cluster\${real.length === 1 ? "" : "s"}, \${state.orphans.length} orphan\${state.orphans.length === 1 ? "" : "s"} · threshold \${state.threshold.toFixed(2)}\`;
  csvBtn.disabled = !(real.length || state.orphans.length);
  mdBtn.disabled = csvBtn.disabled;
}

function removeFromCluster(clusterId, memberIndex) {
  const cluster = state.clusters.find((c) => c.id === clusterId);
  if (!cluster) return;
  const removed = cluster.members.splice(memberIndex, 1)[0];
  if (!removed) return;
  state.orphans.push(removed);

  if (cluster.primaryIndex === memberIndex) {
    cluster.primaryIndex = 0;
  } else if (cluster.primaryIndex > memberIndex) {
    cluster.primaryIndex--;
  }

  if (cluster.members.length < 2) {
    state.orphans.push(...cluster.members);
    state.clusters = state.clusters.filter((c) => c !== cluster);
  }
  render();
}

function moveMember(clusterId, memberIndex, targetId) {
  if (!targetId) return;
  const source = state.clusters.find((c) => c.id === clusterId);
  const target = state.clusters.find((c) => c.id === Number(targetId));
  if (!source || !target || source === target) return;

  const moved = source.members.splice(memberIndex, 1)[0];
  if (!moved) return;

  if (source.primaryIndex === memberIndex) {
    source.primaryIndex = 0;
  } else if (source.primaryIndex > memberIndex) {
    source.primaryIndex--;
  }

  target.members.push(moved);
  if (source.members.length < 2) {
    state.orphans.push(...source.members);
    state.clusters = state.clusters.filter((c) => c !== source);
  }
  render();
}

function moveOrphan(index, targetId) {
  if (!targetId) return;
  const target = state.clusters.find((c) => c.id === Number(targetId));
  if (!target) return;
  const moved = state.orphans.splice(index, 1)[0];
  if (!moved) return;
  target.members.push(moved);
  render();
}

results.addEventListener("change", (event) => {
  if (event.target.classList.contains("primary-select")) {
    const cluster = state.clusters.find((c) => c.id === Number(event.target.dataset.c));
    if (cluster) {
      cluster.primaryIndex = Number(event.target.value);
      render();
    }
  }
});

results.addEventListener("click", (event) => {
  const removeButton = event.target.closest(".remove-keyword");
  if (removeButton) {
    removeFromCluster(Number(removeButton.dataset.c), Number(removeButton.dataset.i));
    return;
  }

  const moveButton = event.target.closest(".move-keyword");
  if (moveButton) {
    const row = moveButton.closest("li");
    const select = row ? row.querySelector(".move-select") : null;
    moveMember(Number(moveButton.dataset.c), Number(moveButton.dataset.i), select ? select.value : "");
    return;
  }

  const orphanButton = event.target.closest(".move-orphan");
  if (orphanButton) {
    const row = orphanButton.closest("li");
    const select = row ? row.querySelector(".orphan-target") : null;
    moveOrphan(Number(orphanButton.dataset.i), select ? select.value : "");
  }
});

function download(filename, type, content) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value) {
  return \`"\${String(value).replace(/"/g, '""')}"\`;
}

csvBtn.addEventListener("click", () => {
  const rows = [["cluster_id", "is_primary", "keyword", "modifiers"]];
  state.clusters.forEach((cluster) => {
    cluster.members.forEach((member, index) => {
      rows.push([cluster.id, index === cluster.primaryIndex, member.original, member.modifiers.join("|")]);
    });
  });
  state.orphans.forEach((member) => {
    rows.push(["orphans", false, member.original, member.modifiers.join("|")]);
  });
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  download("keyword-clusters.csv", "text/csv;charset=utf-8", csv);
});

mdBtn.addEventListener("click", () => {
  const sections = state.clusters.map((cluster) => {
    const primary = cluster.members[cluster.primaryIndex];
    const supporting = cluster.members
      .filter((_, index) => index !== cluster.primaryIndex)
      .map((member) => \`- \${member.original}\`)
      .join("\n");
    return \`# \${primary.original}\nIntent signals: \${cluster.modifiers.length ? cluster.modifiers.map(modifierLabel).join(", ") : "None detected"}\nSupporting keywords:\n\${supporting || "- None"}\`;
  });
  download("keyword-content-map.md", "text/markdown;charset=utf-8", sections.join("\n\n"));
});

mode.addEventListener("change", () => {
  const isCustom = mode.value === "custom";
  customWrap.hidden = !isCustom;
  custom.hidden = !isCustom;
  if (isCustom) customValue.textContent = Number(custom.value).toFixed(2);
  build();
});

custom.addEventListener("input", () => {
  customValue.textContent = Number(custom.value).toFixed(2);
  build();
});

input.addEventListener("input", build);
build();
