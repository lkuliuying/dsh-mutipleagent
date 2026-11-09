import * as THREE from 'three';
import { TeamOffice } from './team-office.js';

const STATIONS = [
  { x: 5.5, y: 5.7, yaw: 180, pose: 'stand' },
  { x: 5.5, y: 12.0, yaw: 180, pose: 'stand' },
  { x: 11.2, y: 9.4, yaw: 180, pose: 'stand' },
  { x: 16.9, y: 6.5, yaw: 180, pose: 'stand' },
];
const COLORS = { blue: '#1769e8', white: '#f6f9fe', steel: '#d2dce8', navy: '#233d61' };
const model = (f, x, y, w, d, options = {}) => ({ f, x, y, w, d, ...options });
const box = (x, y, w, d, h, color, y0 = 0) => ({ special: 'box', x, y, w, d, h, color, y0, abs: true });

export function collaborationScene(count = 4, source = 'codex') {
  const stations = STATIONS.map(station => ({ ...station }));
  for (let slot = stations.length; slot < count; slot++) {
    const extra = slot - STATIONS.length;
    stations.push({ x: 5.5 + (extra % 3) * 5.7, y: 21.5 + Math.floor(extra / 3) * 5.5, yaw: 180, pose: 'stand' });
  }
  const depth = Math.max(20, ...stations.map(station => station.y + 2.8));
  const props = [
    { special: 'floor', x: -12, y: -12, w: 48, d: depth + 26, color: '#dce4ee', color2: '#d2dce8', tile: 8 },
    { special: 'floor', x: .1, y: .1, w: 22, d: depth - 2.1, color: '#e9edf3', color2: '#dee5ee', tile: 4.2, y0: .012 },
    { special: 'wall', axis: 'x', x: -1, y: .05, len: 25, h: 4.3, color: '#e7eef7',
      holes: [[1.1, 4.5, 1.3, 3.8], [7.0, 4.5, 1.3, 3.8], [13, 4.5, 1.3, 3.8], [19, 3.5, 1.3, 3.8]], frame: '#c3cfdf' },
    { special: 'wall', axis: 'z', x: .05, y: 0, len: depth, h: 3.4, color: '#e4ebf5',
      holes: [[2, 3, 1.1, 2.9], [7, 3, 1.1, 2.9], [13, 3, 1.1, 2.9]], frame: '#c7d2e1' },
    box(0, .15, 22, .1, .12, '#bbcbdc'),
    box(.15, 0, .1, depth - 2, .12, '#bbcbdc'),
    { special: 'floor', x: 1.2, y: 1.8, w: 6.5, d: 5.2, color: '#d6e3ef', color2: '#d6e3ef', y0: .02 },
    { special: 'glass', x: 7.65, y: 1.7, w: .05, d: 4.9, h: 2.5, abs: true },
    box(7.6, 1.7, .12, 4.9, .07, '#9cacbf', 2.5),
    box(7.6, 1.7, .1, .1, 2.5, '#becddd'),
    box(7.6, 6.5, .1, .1, 2.5, '#becddd'),
    model('table', 3.0, 3.4, 3.8, 1.6, { h: .88, stretch: true }),
    model('laptop', 4.6, 3.8, .7, .6, { y0: .9, abs: true, rot: 180 }),
    model('chairModernCushion', 3.2, 5.1, .65, .7, { rot: 180 }),
    model('chairModernCushion', 6.0, 5.1, .65, .7, { rot: 180 }),
    model('chairModernCushion', 3.2, 2.6, .65, .7),
    model('chairModernCushion', 5.6, 2.6, .65, .7),
    model('bookcaseOpen', 1.1, .35, 2.5, .5, { h: 1.8 }),
    model('books', 1.3, .5, 1.4, .25, { h: .3, y0: 1, abs: true }),
    model('pottedPlant', 7, .7, .6, .6, { h: 1.6 }),
    model('pottedPlant', .7, 7.0, .55, .55, { h: 1.4 }),
    { special: 'sign', x: 4.5, y: .12, z: 2.75, w: 3.3, h: .64, text: source === 'harness' ? 'DSH / CONTROL' : 'CODEX / CONTROL', bg: '#f0f5fc', fg: '#265a9d' },
  ];
  const solid = [[3, 3.4, 3.8, 1.6], [7.6, 1.7, .12, 4.8]];
  // 保留原四人工位构图，额外成员沿后方新增工作区。
  for (const station of stations.slice(1)) {
    const { x, y } = station;
    props.push(
      { special: 'floor', x: x - 2.2, y: y - 2.7, w: 4.5, d: 3.9, color: '#e1e9f3', color2: '#e1e9f3', y0: .024 },
      box(x - 1.65, y - 1.65, 3.3, 1.0, .92, '#f7faff'),
      box(x - 1.7, y - 1.7, 3.4, 1.1, .08, '#176de8', .92),
      box(x - 1.7, y - 1.7, .07, 1.1, .96, '#397bd5'),
      box(x + 1.63, y - 1.7, .07, 1.1, .96, '#397bd5'),
      model('computerScreen', x - .6, y - 1.5, 1.0, .35, { h: .62, y0: 1.0, abs: true, rot: 180 }),
      model('computerScreen', x + .45, y - 1.45, .75, .3, { h: .53, y0: 1.0, abs: true, rot: 165 }),
      model('computerKeyboard', x - .45, y - 1.0, .75, .22, { y0: 1.02, abs: true }),
      model('computerMouse', x + .45, y - .98, .13, .18, { y0: 1.02, abs: true }),
      model('chairDesk', x - .4, y + .5, .75, .8, { h: 1.0, rot: 180 }),
      model('plantSmall1', x - 1.3, y - 1.3, .3, .3, { h: .4, y0: 1.02, abs: true }),
      model('cardboardBoxClosed', x + 1.0, y + .35, .55, .5, { h: .45 }),
    );
    solid.push([x - 1.7, y - 1.7, 3.4, 1.1]);
  }
  // 设备岛和资料柜提供远景密度，中央通道留给协作路径。
  for (const [sx, sz] of [[10.1, 1.4], [13.0, 1.4], [16.0, 1.4], [19.0, 1.4], [20.3, 7.3], [20.3, 10.4]]) {
    props.push(box(sx, sz, 1.8, 1.0, 2.6, '#e9eff6'));
    for (const dx of [0, 1.73]) props.push(box(sx + dx, sz, .07, 1.0, 2.7, COLORS.blue));
    for (const h of [.18, .72, 1.26, 1.8, 2.34]) {
      props.push(box(sx + .12, sz + .97, 1.55, .05, .35, '#455b78', h));
      props.push({ special: 'glow', x: sx + .23, y: sz + 1.025, y0: h + .12, w: .12, d: .025, h: .035, color: '#52b9ff', intensity: 1.0, abs: true });
    }
    solid.push([sx, sz, 1.8, 1.0]);
  }
  props.push(
    model('loungeSofa', 15.5, 14.7, 3.8, 1.3, { h: 1.05 }),
    model('tableCoffee', 16.4, 16.2, 2.1, .8, { h: .5 }),
    model('books', 16.9, 16.4, .5, .3, { h: .18, y0: .52, abs: true }),
    model('kitchenCabinet', 1.0, 17.0, 4.0, .9, { h: 1, stretch: true }),
    model('kitchenCoffeeMachine', 1.4, 17.2, .65, .5, { h: .65, y0: 1.01, abs: true }),
    model('kitchenSink', 3.4, 17.1, 1.0, .7, { h: .15, y0: 1.01, abs: true }),
    model('pottedPlant', 20.7, 15.7, .7, .7, { h: 1.5 }),
    model('pottedPlant', 8.7, 16.8, .6, .6, { h: 1.5 }),
    { special: 'sign', x: 17.5, y: .12, z: 3.0, w: 3.5, h: .65, text: 'AGENT OPERATIONS', bg: '#edf4fe', fg: '#3d6591' },
  );
  return { W: 23, D: depth, viewH: 4.3, background: '#e7edf7', sky: '#dcecff',
    spawn: { x: 1, y: 15 }, walk: [[0, 0, 23, depth]], solid, stations, pois: [], props };
}

function disposeObject(object) {
  object.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.dispose();
  });
}

export class DemoScene extends TeamOffice {
  constructor(root, { onSelect, reduced = false, pins, count = 4, live = false, source = 'codex' }) {
    super(root, { count, onSelect, reduced, live, scene: collaborationScene(count, source) });
    this.pins = pins;
    this.selectCallback = onSelect;
    this.routeGroup = null;
    this.routeId = null;
    this.eventRoutes = [];
    this.playing = false;
    this.raycaster = new THREE.Raycaster();
    this.onFrame = () => this.updatePins();
    this.canvas.addEventListener('pointerdown', (e) => { this.downPoint = { x: e.clientX, y: e.clientY }; });
    if (this.gl) {
      this.gl.toneMappingExposure = 1.15;
      this.gl.setClearColor('#e7edf7');
      this.hemi.color.set('#f2f8ff'); this.hemi.groundColor.set('#a2b2ca');
      this.sun.color.set('#ffffff');
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.radius = 4;
    }
  }

  fitCamera3D(reset) {
    if (!this.camera || !this.controls || !this.sun) return;
    const narrow = this.cw < 850;
    const extraDepth = Math.max(0, this.plan.D - 20);
    const target = new THREE.Vector3(narrow ? 10.2 : 12.65, .35, (narrow ? 8.8 : 8.15) + extraDepth * .45);
    if (reset || !this.fitted) {
      this.camera.position.copy(target).add(new THREE.Vector3(22, 21.5, 22));
      this.controls.target.copy(target);
      this.camera.zoom = 1;
      this.fitted = true;
    }
    const height = (narrow ? 21 : Math.max(19.5, 28.0 * this.ch / this.cw)) + extraDepth * .85;
    const width = height * this.cw / this.ch;
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.sun.position.set(5, 19, 7);
    this.sun.target.position.set(11, 0, 9 + extraDepth * .5);
    const shadowSize = 18 + extraDepth;
    Object.assign(this.sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 55 + extraDepth });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  build() {
    super.build();
    this.floorMark('COORDINATION', 4.8, 7.1, 3.9, .55);
    this.floorMark('AGENT WORKSPACE', 4.5, 14.0, 4.4, .5);
    this.floorMark('COLLABORATION LANE', 11.0, 12.6, 5.2, .55);
    this.floorMark('VERIFICATION', 16.5, 9.0, 3.9, .5);
    const stripes = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(.28, 1.3), new THREE.MeshStandardMaterial({ color: '#f6faff', roughness: .9 }));
      m.rotation.x = -Math.PI / 2; m.rotation.z = -.55;
      m.position.set(8.0 + i * .45, .03, 15.3);
      stripes.add(m);
    }
    this.room.add(stripes);
    this.routeId = null;
    this.makeRoute(this.selectedId || this.rootId);
  }

  floorMark(text, x, z, w, h) {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
    const c = canvas.getContext('2d'); c.clearRect(0, 0, 768, 128);
    c.fillStyle = '#899eb9'; c.font = '600 38px "Segoe UI",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(text, 384, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, .036, z);
    this.room.add(m);
  }

  actorFor(p) {
    const a = super.actorFor(p);
    if (!a.demoScale) {
      a.obj.scale.multiplyScalar(1.65);
      if (a.head) a.head.scale.multiplyScalar(.78);
      a.obj.userData.agentId = p.s.id;
      a.demoScale = true;
    }
    return a;
  }

  setTeam(agents, rootId) {
    if (this.rootId !== rootId) {
      this.clearEventRoutes();
      this.routeId = null;
    }
    super.setTeam(agents, rootId);
    for (const p of this.people.values()) p.desk.pose = 'stand';
    if (this.selectedId && !this.people.has(this.selectedId)) this.selectedId = rootId;
    this.makeRoute(this.selectedId || rootId);
  }

  bubble() {}

  pathBetween(from, to) {
    if (!from?.desk || !to?.desk || from === to) return null;
    const a = from.desk.seat, b = to.desk.seat;
    const start = new THREE.Vector3(a.x + (from.s.id === this.rootId ? .8 : 0), .07, a.y + (from.s.id === this.rootId ? 1.1 : .65));
    const end = new THREE.Vector3(b.x, .07, b.y + .65);
    const points = [start, new THREE.Vector3(8.2, .07, start.z), new THREE.Vector3(8.2, .07, end.z), end];
    return new THREE.CatmullRomCurve3(points.filter((point, i) => !i || point.distanceTo(points[i - 1]) > .01), false, 'centripetal', .04);
  }

  addRouteLine(group, curve) {
    for (const [radius, color, opacity] of [[.18, '#42c8ff', .16], [.065, '#0870ff', .94]]) {
      group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 100, radius, 6, false),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
    }
    const dash = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(70)),
      new THREE.LineDashedMaterial({ color: '#e9fbff', dashSize: .12, gapSize: .18, linewidth: 2 }));
    dash.position.y = .07; dash.computeLineDistances(); group.add(dash);
  }

  clearEventRoutes() {
    for (const route of this.eventRoutes || []) {
      this.scene?.remove(route.group); disposeObject(route.group);
    }
    this.eventRoutes = [];
  }

  makeRoute(id) {
    const person = this.people?.get(id);
    if (!this.loaded || !this.room || !person) return;
    const parent = this.people.get(person.s.parentId);
    const signature = [id, person.desk.seat.x, person.desk.seat.y,
      parent?.s.id, parent?.desk.seat.x, parent?.desk.seat.y].join(':');
    if (this.routeId === id && this.routeSignature === signature) return;
    if (this.routeGroup) { this.scene.remove(this.routeGroup); disposeObject(this.routeGroup); }
    this.routeId = id;
    this.routeSignature = signature;
    this.routeGroup = new THREE.Group();
    this.scene.add(this.routeGroup);
    const s = person.desk.seat;
    this.routeCurve = this.pathBetween(parent, person);
    this.packet = null;
    if (this.routeCurve) {
      this.addRouteLine(this.routeGroup, this.routeCurve);
      if (!this.live) {
        this.packet = new THREE.Mesh(new THREE.SphereGeometry(.115, 12, 8), new THREE.MeshBasicMaterial({ color: '#d8f9ff' }));
        this.routeGroup.add(this.packet);
      }
    }
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) {
      const x = s.x + dx * 1.95, z = s.y - .4 + dz * 1.4;
      for (const points of [
        [new THREE.Vector3(x, .05, z), new THREE.Vector3(x - dx * .6, .05, z)],
        [new THREE.Vector3(x, .05, z), new THREE.Vector3(x, .05, z - dz * .5)],
        [new THREE.Vector3(x, .05, z), new THREE.Vector3(x, .7, z)],
      ]) {
        const curve = new THREE.LineCurve3(points[0], points[1]);
        this.routeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 1, .035, 6, false), new THREE.MeshBasicMaterial({ color: '#08a0ff' })));
      }
    }
  }

  select(id, focus = false) {
    this.selectedId = id;
    this.makeRoute(id);
    if (focus && this.cw < 850) {
      const p = this.people.get(id);
      if (p && this.camera) {
        const next = new THREE.Vector3(p.x, .3, p.y);
        this.camera.position.add(next.clone().sub(this.controls.target));
        this.controls.target.copy(next);
      }
    }
  }

  updatePins() {
    if (!this.pins || !this.camera || !this.loaded) return;
    for (const pin of this.pins.children) {
      const p = this.people.get(pin.dataset.agent);
      if (!p) continue;
      const v = new THREE.Vector3(p.x, 2.2, p.y - .4).project(this.camera);
      const x = (v.x + 1) * .5 * this.cw, y = (1 - v.y) * .5 * this.ch;
      pin.style.left = x + 'px'; pin.style.top = y + 'px';
      pin.hidden = v.z > 1 || x < -40 || x > this.cw + 40 || y < 70 || y > this.ch - 70;
    }
  }

  animateEvent(event) {
    if (event.type === 'report') super.animateEvent(event);
    this.flows = [];
    if (this.reduced || !this.loaded || !['assign', 'message', 'report'].includes(event.type)) return;
    const from = this.people.get(event.sessionId);
    const to = this.people.get(event.type === 'report' ? from?.s.parentId : event.targetId);
    const curve = this.pathBetween(from, to);
    if (!curve) return;
    const group = new THREE.Group();
    this.addRouteLine(group, curve);
    const packet = new THREE.Mesh(new THREE.SphereGeometry(.14, 12, 8), new THREE.MeshBasicMaterial({ color: '#d8f9ff' }));
    group.add(packet); this.scene.add(group);
    this.eventRoutes.push({ group, curve, packet, start: performance.now() });
    while (this.eventRoutes.length > 12) {
      const old = this.eventRoutes.shift(); this.scene.remove(old.group); disposeObject(old.group);
    }
  }

  setReduced(value) {
    super.setReduced(value);
    if (value) this.clearEventRoutes();
  }

  step(dt) { if (this.playing) super.step(dt); }

  syncActors(dt) {
    if (this.hemi) this.hemi.intensity = 1.6;
    if (this.sun) this.sun.intensity = 2.0;
    super.syncActors(this.playing ? dt : 0);
  }

  pointer(e, click) {
    if (!click || !this.camera || !this.loaded) return;
    if (this.downPoint && Math.hypot(e.clientX - this.downPoint.x, e.clientY - this.downPoint.y) > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, 1 - (e.clientY - rect.top) / rect.height * 2), this.camera);
    for (const hit of this.raycaster.intersectObjects([...this.actors.values()].map((a) => a.obj), true)) {
      let object = hit.object;
      while (object && !object.userData.agentId) object = object.parent;
      if (object?.userData.agentId) { this.selectCallback(object.userData.agentId); return; }
    }
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(floor, point)) {
      for (const person of this.people.values()) {
        const s = person.desk.seat;
        if (Math.abs(point.x - s.x) < 2.1 && Math.abs(point.z - s.y + .5) < 1.8) {
          this.selectCallback(person.s.id); return;
        }
      }
    }
  }

  draw() {
    const now = performance.now();
    for (const route of this.eventRoutes || []) {
      const age = now - route.start;
      route.packet.position.copy(route.curve.getPoint(Math.min(1, age / 2200)));
      route.packet.position.y += .09;
      if (age >= 2600) { this.scene.remove(route.group); disposeObject(route.group); }
    }
    if (this.eventRoutes) this.eventRoutes = this.eventRoutes.filter(route => now - route.start < 2600);
    const result = super.draw();
    if (this.packet && this.routeCurve) {
      const t = this.reduced || !this.playing ? .58 : (performance.now() % 4500) / 4500;
      this.packet.position.copy(this.routeCurve.getPoint(t)); this.packet.position.y += .09;
    }
    return result;
  }

  destroy() {
    this.clearEventRoutes();
    if (this.routeGroup) disposeObject(this.routeGroup);
    super.destroy();
  }
}
