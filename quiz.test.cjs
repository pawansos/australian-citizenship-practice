const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class Element {
  constructor() {
    this.children = [];
    this.listeners = {};
    this.style = {};
    this.attrs = {};
    this.value = "practice";
    this.classList = { toggle() {}, add() {} };
  }
  setAttribute(key, value) { this.attrs[key] = value; }
  append(...items) { this.children.push(...items); }
  replaceChildren() { this.children = []; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  querySelectorAll() { return this.children; }
  focus() {}
  scrollIntoView() {}
}

function setup(storage = new Map(), storageFailure = null) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  let now = 1000;
  const intervals = new Set();
  const warnings = [];
  const context = vm.createContext({
    document: { getElementById: get, querySelector: get, createElement: () => new Element() },
    Date: { now: () => now },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback),
    console: { warn: (...args) => warnings.push(args) },
    localStorage: {
      getItem(key) {
        if (storageFailure === "read") throw new Error("Storage unavailable");
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageFailure === "write") throw new Error("Storage full");
        storage.set(key, value);
      }
    }
  });
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  vm.runInContext(html.split("<script>")[1].split("</script>")[0], context);
  return {
    get,
    run: code => vm.runInContext(code, context),
    advance: milliseconds => { now += milliseconds; },
    intervals,
    warnings,
    storage
  };
}

test("question bank and 500 random sets have correct answers, five values and distinct topics", () => {
  const app = setup();
  app.run(`
    if (questions.length !== 182) throw Error("Wrong bank size");
    if (questionBank.length !== new Set(questions.map(item => item.q)).size) throw Error("Duplicate bank entry");
    const original = JSON.stringify(questions);
    for (const item of questions) {
      if (item.o.length !== 4 || new Set(item.o).size !== 4 || !item.e || !item.o[item.a] || !item.t) throw Error("Invalid question");
    }
    for (let n = 0; n < 500; n++) {
      const set = createPracticeSet();
      if (set.length !== 20 || new Set(set.map(item => item.q)).size !== 20) throw Error("Repeated question");
      if (new Set(set.map(item => item.t)).size !== 20) throw Error("Repeated topic");
      if (new Set(set.map(item => item.c)).size !== 6) throw Error("Missing category");
      if (set.filter(item => item.c === "Australian values").length !== 5) throw Error("Wrong values count");
      for (const item of set) {
        const answer = item.o[item.a];
        shuffleOptions(item);
        if (item.o[item.a] !== answer) throw Error("Wrong shuffled answer");
      }
    }
    if (JSON.stringify(questions) !== original) throw Error("Bank mutated");
  `);
});

test("all capital and other related question variants share an explicit topic", () => {
  const app = setup();
  app.run(`
    const capitals = questions.filter(item => /capital/i.test(item.q));
    if (!capitals.every(item => item.t === "capital-cities")) throw Error("Missed capital variant");
    for (const topic of ["national-flag", "religion", "freedom-expression", "rule-of-law", "family-violence", "marriage-consent"]) {
      if (questions.filter(item => item.t === topic).length < 2) throw Error("Ungrouped similar variants");
    }
  `);
});

test("500 successive sets do not repeat within a cycle or overlap the previous set at rollover", () => {
  const app = setup();
  app.run(`
    let prior = practiceQuestions.map(item => item.q);
    let cycle = history.cycle;
    let used = new Set(prior);
    let rollovers = 0;
    const signatures = new Set();
    for (let n = 0; n < 500; n++) {
      restart();
      const ids = practiceQuestions.map(item => item.q);
      if (ids.some(id => prior.includes(id))) throw Error("Adjacent sets overlap");
      if (new Set(practiceQuestions.map(item => item.t)).size !== 20) throw Error("Repeated topic");
      if (practiceQuestions.filter(item => item.c === "Australian values").length !== 5) throw Error("Wrong values quota");
      if (new Set(practiceQuestions.map(item => item.c)).size !== 6) throw Error("Missing category");
      if (history.cycle === cycle) {
        if (ids.some(id => used.has(id))) throw Error("Repeated question in cycle");
      } else {
        if (!document.getElementById("cycle-status").textContent.includes("New cycle started")) throw Error("Silent rollover");
        rollovers++;
        used = new Set();
        cycle = history.cycle;
      }
      ids.forEach(id => used.add(id));
      signatures.add(ids.join("|"));
      prior = ids;
    }
    if (!rollovers || signatures.size < 490) throw Error("Not random or did not test rollover");
  `);
});

test("reload and switching modes preserve history, including reserved unanswered questions", () => {
  const storage = new Map();
  const first = setup(storage);
  const firstIds = first.run("practiceQuestions.map(item => item.q)");
  const second = setup(storage);
  const secondIds = second.run("practiceQuestions.map(item => item.q)");
  assert.equal(secondIds.some(id => firstIds.includes(id)), false);
  second.get("mode").value = "exam";
  second.get("start-set").listeners.click();
  const thirdIds = second.run("practiceQuestions.map(item => item.q)");
  assert.equal(thirdIds.some(id => [...firstIds, ...secondIds].includes(id)), false);
});

test("infeasible unused pools return null instead of relaxing topic or values rules", () => {
  const app = setup();
  app.run(`
    const allowed = questionBank.filter(item => item.c !== "Australian values" || item.t === "religion");
    const excluded = new Set(questionBank.filter(item => !allowed.includes(item)).map(item => item.q));
    if (createPracticeSet(excluded) !== null) throw Error("Allowed repeated values topic");
    if (createPracticeSet(new Set(questionBank.map(item => item.q))) !== null) throw Error("Ignored exhaustion");
  `);
});

for (const failure of ["read", "write"]) {
  test(`storage ${failure} failure is visible and same-page history still prevents repeats`, () => {
    const app = setup(new Map(), failure);
    assert.equal(app.get("history-warning").hidden, false);
    assert.ok(app.warnings.length > 0);
    const prior = app.run("practiceQuestions.map(item => item.q)");
    app.get("restart").listeners.click();
    const next = app.run("practiceQuestions.map(item => item.q)");
    assert.equal(next.some(id => prior.includes(id)), false);
  });
}

test("corrupt saved history is reported explicitly and does not prevent practice", () => {
  const app = setup(new Map([["citizenship-practice-history-v1", "{broken"]]));
  assert.equal(app.get("history-warning").hidden, false);
  assert.equal(app.run("practiceQuestions.length"), 20);
});

test("practice preserves immediate feedback, prevents duplicate scoring and resets", () => {
  const app = setup();
  app.run("selected = practiceQuestions[0].a; submitAnswer(); submitAnswer();");
  assert.equal(app.get("feedback").hidden, false);
  assert.equal(app.get("score").textContent, "1 / 1");
  app.get("next").listeners.click();
  assert.equal(app.get("progress-label").textContent, "Question 2 of 20");
  app.get("restart").listeners.click();
  assert.equal(app.get("score").textContent, "0 / 0");
});

for (const scenario of [
  { label: "15/20 with all values correct passes", wrongValues: false, expected: "Simulation target met" },
  { label: "19/20 with one wrong values answer fails", wrongValues: true, expected: "Simulation target not met" }
]) {
  test(scenario.label, () => {
    const app = setup();
    app.get("mode").value = "exam";
    app.get("start-set").listeners.click();
    assert.equal(app.get("timer").textContent, "45:00");
    assert.equal(app.intervals.size, 1);
    app.run(`
      let mistakes = 0;
      for (let step = 0; step < 20; step++) {
        const item = practiceQuestions[index];
        const wrong = ${scenario.wrongValues}
          ? item.c === "Australian values" && mistakes < 1
          : item.c !== "Australian values" && mistakes < 5;
        if (wrong) mistakes++;
        selected = wrong ? (item.a + 1) % 4 : item.a;
        submitAnswer();
        if (step < 19 && !feedbackEl.hidden) throw Error("Exam leaked feedback");
      }
    `);
    assert.ok(app.get("pass-result").textContent.startsWith(scenario.expected));
    assert.equal(app.get("complete").hidden, false);
    assert.equal(app.get("review").children.length, 20);
    assert.equal(app.intervals.size, 0);
  });
}

test("deadline expires even if interval was delayed and rejects a late answer", () => {
  const app = setup();
  app.get("mode").value = "exam";
  app.get("start-set").listeners.click();
  app.advance(45 * 60 * 1000);
  app.run("selected = practiceQuestions[0].a; submitAnswer();");
  assert.equal(app.get("result-heading").textContent, "Time is up.");
  assert.equal(app.get("score").textContent, "0 / 20");
  assert.equal(app.get("remaining").textContent, "20");
  assert.equal(app.get("review").children.length, 20);
  assert.equal(app.intervals.size, 0);
  app.get("mode").value = "practice";
  app.get("try-again").listeners.click();
  assert.equal(app.get("timer-stat").hidden, true);
  assert.equal(app.get("score").textContent, "0 / 0");
});
