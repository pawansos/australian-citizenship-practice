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

function setup() {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  let now = 1000;
  const intervals = new Set();
  const context = vm.createContext({
    document: { getElementById: get, querySelector: get, createElement: () => new Element() },
    Date: { now: () => now },
    setInterval: callback => { intervals.add(callback); return callback; },
    clearInterval: callback => intervals.delete(callback)
  });
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  vm.runInContext(html.split("<script>")[1].split("</script>")[0], context);
  return {
    get,
    run: code => vm.runInContext(code, context),
    advance: milliseconds => { now += milliseconds; },
    intervals
  };
}

test("170 questions are valid; random sets cover every category and five values questions", () => {
  const app = setup();
  app.run(`
    if (questions.length !== 170) throw Error("Wrong bank size");
    const original = JSON.stringify(questions);
    for (const item of questions) {
      if (item.o.length !== 4 || new Set(item.o).size !== 4 || !item.e || !item.o[item.a]) throw Error("Invalid question");
    }
    for (let n = 0; n < 500; n++) {
      const set = createPracticeSet();
      if (set.length !== 20 || new Set(set.map(item => item.q)).size !== 20) throw Error("Repeated question");
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
