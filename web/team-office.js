import * as THREE from 'three';
import { Office3D } from '../vendor/office3d.js';

export function officeScene(count) {
  const workerCount = Math.max(6, Math.ceil(Math.max(0, count - 1) / 2) * 2);
  const rows = workerCount / 2;
  const W = 13, D = Math.max(11.5, rows * 2.8 + 3);
  const stations = [{ x: 10.1, y: 3.6, pose: 'stand', yaw: 180 }];
  const props = [
    { special: 'floor', x: 0, y: 0, w: W, d: D, color: '#e9ddc5', color2: '#dbccb2', tile: 2.6 },
    { special: 'floor', x: 8, y: 0.2, w: 4.8, d: 6.8, color: '#d6e2d4', color2: '#d6e2d4', y0: .008 },
    { special: 'wall', axis: 'x', x: 0, y: 0, len: W, color: '#f2f0e4', holes: [[1.1, 3.6, .8, 2.2], [6.1, 2.2, .8, 2.2]] },
    { special: 'wall', axis: 'z', x: 0, y: 0, len: D, color: '#f2f0e4', holes: [[D - 2.2, 1.1, 0, 2.1]] },
    { special: 'sign', x: 10, y: .08, z: 1.65, w: 2.4, h: .6, text: 'COORDINATION', fg: '#386c53', bg: '#e8eddf' },
    { f: 'table', x: 8.65, y: 2.05, w: 3.0, d: 1.2, h: .78, stretch: true },
    { f: 'laptop', x: 9.6, y: 2.3, w: .6, d: .5, y0: .78, abs: true, rot: 180 },
    { f: 'pottedPlant', x: 12, y: .6, w: .6, d: .6, h: 1.3 },
    { f: 'bookcaseOpen', x: 8.9, y: .1, w: 2, d: .45, h: 1.1 },
    { f: 'loungeSofa', x: 9.4, y: D - 2.5, w: 2.8, d: 1.1 },
    { f: 'tableCoffee', x: 10, y: D - 1.4, w: 1.5, d: .7 },
    { f: 'plantSmall1', x: 10.6, y: D - 1.1, w: .2, d: .2, y0: .5, abs: true },
    { f: 'kitchenCoffeeMachine', x: 8.7, y: 7.5, w: .65, d: .55, y0: .85, abs: true },
    { f: 'kitchenCabinet', x: 8.45, y: 7.3, w: 1.2, d: .8, h: .85 },
    { f: 'pottedPlant', x: .45, y: D - .9, w: .6, d: .6, h: 1.1 },
  ];
  const solid = [[8.65, 2.05, 3, 1.2]];
  for (let i = 0; i < workerCount; i++) {
    const x = 1.9 + (i % 2) * 3.25, y = 3.3 + Math.floor(i / 2) * 2.8;
    stations.push({ x, y, pose: 'sit', yaw: 180 });
    props.push(
      { f: 'desk', x: x - .85, y: y - 1.2, w: 1.7, d: .8, h: .78, stretch: true },
      { f: 'chairDesk', x: x - .32, y: y - .28, w: .64, d: .64, h: .75, rot: 180 },
      { f: 'computerScreen', x: x - .35, y: y - 1.0, w: .7, d: .25, h: .5, abs: true, y0: .78, rot: 180 },
      { f: 'computerKeyboard', x: x - .25, y: y - .6, w: .5, d: .2, abs: true, y0: .79 },
      { f: 'plantSmall2', x: x + .5, y: y - 1.0, w: .2, d: .2, abs: true, y0: .79 },
    );
    solid.push([x - .85, y - 1.2, 1.7, .8]);
  }
  return { W, D, background: '#edf1e7', sky: '#d2e7e3', spawn: { x: .6, y: D - 1.5 },
    walk: [[0, 0, W, D]], solid, stations, pois: [], props };
}

export class TeamOffice extends Office3D {
  constructor(root, { count, onSelect, reduced = false, live = false, scene = officeScene(count) }) {
    super(root, { scene, showAgent: false,
      label: (s) => s.name, onHover: (s, _point, clicked) => { if (clicked && s) onSelect(s.id); } });
    this.reduced = reduced;
    this.live = live;
    this.flows = [];
    this.seatFor = new Map();
    this.selectedId = null;
    this.rootId = null;
    if (this.controls) this.controls.enableDamping = !reduced;
    this.pal.dark = false;
    this.pal.text = '#3e6150';
    this.pal.tagBg = 'rgba(255,255,248,.94)';
  }

  setTeam(agents, rootId) {
    if (this.rootId !== rootId) {
      this.people.clear();
      this.seatFor.clear();
      this.flows = [];
      this.rootId = rootId;
      this.first = true;
    }
    const ordered = [...agents].sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 :
      Number.isInteger(a.slot) && Number.isInteger(b.slot) ? a.slot - b.slot : (a.startedAt || 0) - (b.startedAt || 0)));
    // 真实快照提供稳定编号；未提供编号的原监控页面继续沿用既有顺序。
    for (const s of ordered) if (Number.isInteger(s.slot) && s.slot >= 0) this.seatFor.set(s.id, s.slot);
    for (const s of ordered) {
      if (!this.seatFor.has(s.id)) {
        let slot = 0;
        const occupied = new Set(this.seatFor.values());
        while (occupied.has(slot)) slot++;
        this.seatFor.set(s.id, slot);
      }
      const desk = this.plan.desks[this.seatFor.get(s.id)];
      if (!desk) continue;
      let p = this.people.get(s.id);
      if (!p) {
        p = this.newPerson({ ...s, key: s.id });
        p.x = desk.seat.x; p.y = desk.seat.y;
        p.placeOnArrive = false;
        this.people.set(s.id, p);
      }
      if (p.desk && p.desk !== desk && p.mode !== 'report') {
        p.x = desk.seat.x; p.y = desk.seat.y; p.path = [];
      }
      p.s = s;
      p.desk = desk;
      if (!p.reportUntil && p.mode !== 'report') p.mode = 'work';
    }
    const ids = new Set(agents.map((s) => s.id));
    for (const id of this.people.keys()) if (!ids.has(id)) this.people.delete(id);
    this.first = false;
  }

  setReduced(value) {
    this.reduced = value;
    if (this.controls) this.controls.enableDamping = !value;
    if (value) {
      this.flows = [];
      for (const p of this.people.values()) {
        p.path = []; p.reportUntil = null; p.mode = 'work';
        p.x = p.desk.seat.x; p.y = p.desk.seat.y;
      }
    }
  }

  focus(id) {
    this.selectedId = id;
    const p = this.people.get(id);
    if (!p || !this.loaded) return;
    const target = new THREE.Vector3(p.x, .7, p.y);
    const delta = target.clone().sub(this.controls.target);
    this.camera.position.add(delta);
    this.controls.target.copy(target);
    this.camera.zoom = Math.max(this.camera.zoom, 1.8);
    this.camera.updateProjectionMatrix();
  }

  resetCamera() { if (this.loaded) { this.fitted = false; this.fitCamera3D(true); } }

  animateEvent(e) {
    if (this.reduced) return;
    const now = performance.now();
    if (e.type === 'assign' || e.type === 'message') {
      this.flows.push({ from: e.sessionId, to: e.targetId, start: now });
    } else if (e.type === 'report' && e.sessionId !== this.rootId) {
      const p = this.people.get(e.sessionId);
      const parent = this.people.get(p?.s.parentId);
      if (!p || !parent) return;
      p.mode = 'report';
      p.reportUntil = null;
      p.reportStart = now;
      this.goTo(p, { x: parent.desk.seat.x - .8, y: parent.desk.seat.y + 1.3 });
      this.flows.push({ from: e.sessionId, to: parent.key, start: now });
    }
    this.flows = this.flows.slice(-12);
  }

  step(dt) {
    if (!this.people) return;
    if (!this.reduced) super.step(dt);
    const now = performance.now();
    for (const p of this.people.values()) if (p.mode === 'report' && !p.path.length) {
      p.reportUntil ||= now + 1700;
      if (now > p.reportUntil) {
        p.mode = 'work'; p.reportUntil = null;
        this.goTo(p, p.desk.seat);
      }
    }
  }

  stateOf(p) {
    if (p.mode === 'report' && !p.path.length) return { pose: 'stand', face: 'back', act: 'wave', sitZ: 0 };
    if (['done', 'closed', 'interrupted', 'unknown'].includes(p.s.status) && !p.path.length)
      return { pose: p.desk.pose === 'stand' ? 'stand' : 'sit', face: 'back', act: null, sitZ: .34 };
    return super.stateOf(p);
  }

  syncActors(dt) { super.syncActors(this.reduced ? 0 : dt); }

  bubble(p, at) {
    const c = this.ctx;
    const color = { error: '#b65850', waiting: '#b4893e', waiting_agents: '#b4893e', done: '#5a8966',
      interrupted: '#8c9487', closed: '#8c9487', unknown: '#8c9487' }[p.s.status] || '#3d8b70';
    const label = p.s.name || 'Agent';
    c.save();
    c.font = '500 11px "Microsoft YaHei UI", sans-serif';
    const w = Math.min(160, c.measureText(label).width + 25);
    const y = at.y - 14;
    this.roundRect(at.x - w / 2, y - 11, w, 23, 6, 'rgba(255,255,248,.94)', p.key === this.selectedId ? '#5d9476' : 'rgba(154,177,147,.4)');
    c.fillStyle = color;
    c.beginPath(); c.arc(at.x - w / 2 + 9, y + .5, 2.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#45624c'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(label, at.x + 4, y + 1, w - 18);
    c.restore();
  }

  draw() {
    const result = super.draw();
    if (!this.loaded || !this.flows) return result;
    const c = this.ctx, now = performance.now();
    const project = (p) => {
      const v = new THREE.Vector3(p.x, 1.1, p.y).project(this.camera);
      return { x: (v.x + 1) / 2 * this.cw, y: (1 - v.y) / 2 * this.ch };
    };
    this.flows = this.flows.filter((f) => now - f.start < 2600);
    for (const f of this.flows) {
      const from = this.people.get(f.from), to = this.people.get(f.to);
      if (!from || !to) continue;
      const a = project(from), b = project(to), t = Math.min(1, (now - f.start) / 2200);
      const cy = Math.min(a.y, b.y) - 55;
      c.save(); c.strokeStyle = 'rgba(54,132,99,.45)'; c.lineWidth = 1.5; c.setLineDash([4, 5]);
      c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo((a.x + b.x) / 2, cy, b.x, b.y); c.stroke();
      const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * ((a.x + b.x) / 2) + t ** 2 * b.x;
      const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t ** 2 * b.y;
      c.setLineDash([]); c.fillStyle = '#3c8c69'; c.beginPath(); c.arc(x, y, 4, 0, Math.PI * 2); c.fill(); c.restore();
    }
    return result;
  }

  destroy() {
    const resources = new Set();
    this.scene?.traverse((o) => {
      if (o.geometry) resources.add(o.geometry);
      for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
        resources.add(m); for (const v of Object.values(m)) if (v?.isTexture) resources.add(v);
      }
    });
    for (const a of this.actors?.values() || []) a.mixer.stopAllAction();
    for (const r of resources) r.dispose();
    super.destroy();
  }
}
