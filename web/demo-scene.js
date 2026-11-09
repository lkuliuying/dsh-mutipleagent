import * as THREE from 'three';
import { TeamOffice } from './team-office.js';
import { hasKey, locale, onLangChange, t } from './i18n.mjs';

const STATIONS = [
  { x: 5.5, y: 5.35, yaw: 180, pose: 'sit' },
  { x: 5.5, y: 12.0, yaw: 180, pose: 'sit' },
  { x: 11.2, y: 9.4, yaw: 180, pose: 'sit' },
  { x: 16.9, y: 6.5, yaw: 180, pose: 'sit' },
];
const COLORS = { blue: '#1769e8', white: '#f6f9fe', steel: '#d2dce8', navy: '#233d61' };
const model = (f, x, y, w, d, options = {}) => ({ f, x, y, w, d, ...options });
const box = (x, y, w, d, h, color, y0 = 0) => ({ special: 'box', x, y, w, d, h, color, y0, abs: true });

export function collaborationScene(count = 4, source = 'codex') {
  const stations = STATIONS.map(station => ({ ...station }));
  for (let slot = stations.length; slot < count; slot++) {
    const extra = slot - STATIONS.length;
    stations.push({ x: 5.5 + (extra % 3) * 5.7, y: 21.5 + Math.floor(extra / 3) * 5.5, yaw: 180, pose: 'sit' });
  }
  const depth = Math.max(20, ...stations.map(station => station.y + 2.8));
  const props = [
    { special: 'floor', x: -12, y: -12, w: 48, d: depth + 26, color: '#dce4ee', color2: '#d2dce8', tile: 8 },
    { special: 'floor', x: 0.1, y: 0.1, w: 22, d: depth - 2.1, color: '#e9edf3', color2: '#dee5ee', tile: 4.2, y0: 0.012 },
    {
      special: 'wall',
      axis: 'x',
      x: -1,
      y: 0.05,
      len: 25,
      h: 4.3,
      color: '#e7eef7',
      holes: [
        [1.1, 4.5, 1.3, 3.8],
        [7.0, 4.5, 1.3, 3.8],
        [13, 4.5, 1.3, 3.8],
        [19, 3.5, 1.3, 3.8],
      ],
      frame: '#c3cfdf',
    },
    {
      special: 'wall',
      axis: 'z',
      x: 0.05,
      y: 0,
      len: depth,
      h: 3.4,
      color: '#e4ebf5',
      holes: [
        [2, 3, 1.1, 2.9],
        [7, 3, 1.1, 2.9],
        [13, 3, 1.1, 2.9],
      ],
      frame: '#c7d2e1',
    },
    box(0, 0.15, 22, 0.1, 0.12, '#bbcbdc'),
    box(0.15, 0, 0.1, depth - 2, 0.12, '#bbcbdc'),
    { special: 'floor', x: 1.2, y: 1.8, w: 6.5, d: 5.2, color: '#d6e3ef', color2: '#d6e3ef', y0: 0.02 },
    { special: 'glass', x: 7.65, y: 1.7, w: 0.05, d: 4.9, h: 2.5, abs: true },
    box(7.6, 1.7, 0.12, 4.9, 0.07, '#9cacbf', 2.5),
    box(7.6, 1.7, 0.1, 0.1, 2.5, '#becddd'),
    box(7.6, 6.5, 0.1, 0.1, 2.5, '#becddd'),
    model('table', 3.0, 3.4, 3.8, 1.6, { h: 0.88, stretch: true }),
    model('laptop', 4.6, 3.8, 0.7, 0.6, { y0: 0.9, abs: true, rot: 180 }),
    model('computerScreen', 5.2, 4.3, 0.95, 0.32, { h: 0.6, y0: 0.9, abs: true, rot: 0 }),
    model('computerKeyboard', 5.15, 4.72, 0.7, 0.22, { y0: 0.9, abs: true }),
    model('computerMouse', 5.95, 4.72, 0.12, 0.18, { y0: 0.9, abs: true }),
    model('chairDesk', 5.125, 4.95, 0.75, 0.8, { h: 1.0, rot: 180 }),
    model('chairModernCushion', 3.2, 5.1, 0.65, 0.7, { rot: 180 }),
    model('chairModernCushion', 3.2, 2.6, 0.65, 0.7),
    model('chairModernCushion', 5.6, 2.6, 0.65, 0.7),
    model('bookcaseOpen', 1.1, 0.35, 2.5, 0.5, { h: 1.8 }),
    model('books', 1.3, 0.5, 1.4, 0.25, { h: 0.3, y0: 1, abs: true }),
    model('pottedPlant', 7, 0.7, 0.6, 0.6, { h: 1.6 }),
    model('pottedPlant', 0.7, 7.0, 0.55, 0.55, { h: 1.4 }),
    {
      special: 'sign',
      x: 4.5,
      y: 0.12,
      z: 2.75,
      w: 3.0,
      h: 0.64,
      text: t(source === 'harness' ? 'scene.sign.harness' : 'scene.sign.codex'),
      bg: '#f0f5fc',
      fg: '#265a9d',
    },
  ];
  const solid = [
    [3, 3.4, 3.8, 1.6],
    [7.6, 1.7, 0.12, 4.8],
  ];
  // 保留原四人工位构图，额外成员沿后方新增工作区。
  for (const station of stations.slice(1)) {
    const { x, y } = station;
    props.push(
      { special: 'floor', x: x - 2.2, y: y - 2.7, w: 4.5, d: 3.9, color: '#e1e9f3', color2: '#e1e9f3', y0: 0.024 },
      box(x - 1.65, y - 1.65, 3.3, 1.0, 0.92, '#f7faff'),
      box(x - 1.7, y - 1.7, 3.4, 1.1, 0.08, '#176de8', 0.92),
      box(x - 1.7, y - 1.7, 0.07, 1.1, 0.96, '#397bd5'),
      box(x + 1.63, y - 1.7, 0.07, 1.1, 0.96, '#397bd5'),
      model('computerScreen', x - 0.6, y - 1.5, 1.0, 0.35, { h: 0.62, y0: 1.0, abs: true, rot: 0 }),
      model('computerScreen', x + 0.45, y - 1.45, 0.75, 0.3, { h: 0.53, y0: 1.0, abs: true, rot: -12 }),
      model('computerKeyboard', x - 0.45, y - 0.74, 0.75, 0.22, { y0: 1.02, abs: true }),
      model('computerMouse', x + 0.45, y - 0.72, 0.13, 0.18, { y0: 1.02, abs: true }),
      model('chairDesk', x - 0.375, y - 0.4, 0.75, 0.8, { h: 1.0, rot: 180 }),
      model('plantSmall1', x - 1.3, y - 1.3, 0.3, 0.3, { h: 0.4, y0: 1.02, abs: true }),
      model('cardboardBoxClosed', x + 1.0, y + 0.35, 0.55, 0.5, { h: 0.45 }),
    );
    solid.push([x - 1.7, y - 1.7, 3.4, 1.1]);
  }
  // 设备岛和资料柜提供远景密度，中央通道留给协作路径。
  for (const [sx, sz] of [
    [10.1, 1.4],
    [13.0, 1.4],
    [16.0, 1.4],
    [19.0, 1.4],
    [20.3, 7.3],
    [20.3, 10.4],
  ]) {
    props.push(box(sx, sz, 1.8, 1.0, 2.6, '#e9eff6'));
    for (const dx of [0, 1.73]) props.push(box(sx + dx, sz, 0.07, 1.0, 2.7, COLORS.blue));
    for (const h of [0.18, 0.72, 1.26, 1.8, 2.34]) {
      props.push(box(sx + 0.12, sz + 0.97, 1.55, 0.05, 0.35, '#455b78', h));
      props.push({ special: 'glow', x: sx + 0.23, y: sz + 1.025, y0: h + 0.12, w: 0.12, d: 0.025, h: 0.035, color: '#52b9ff', intensity: 1.0, abs: true });
    }
    solid.push([sx, sz, 1.8, 1.0]);
  }
  props.push(
    model('loungeSofa', 15.5, 14.7, 3.8, 1.3, { h: 1.05 }),
    model('tableCoffee', 16.4, 16.2, 2.1, 0.8, { h: 0.5 }),
    model('books', 16.9, 16.4, 0.5, 0.3, { h: 0.18, y0: 0.52, abs: true }),
    model('kitchenCabinet', 1.0, 17.0, 4.0, 0.9, { h: 1, stretch: true }),
    model('kitchenCoffeeMachine', 1.4, 17.2, 0.65, 0.5, { h: 0.65, y0: 1.01, abs: true }),
    model('kitchenSink', 3.4, 17.1, 1.0, 0.7, { h: 0.15, y0: 1.01, abs: true }),
    model('pottedPlant', 20.7, 15.7, 0.7, 0.7, { h: 1.5 }),
    model('pottedPlant', 8.7, 16.8, 0.6, 0.6, { h: 1.5 }),
    { special: 'sign', x: 17.5, y: 0.12, z: 3.0, w: 3.2, h: 0.65, text: t('scene.sign.agents'), bg: '#edf4fe', fg: '#3d6591' },
  );
  return {
    W: 23,
    D: depth,
    viewH: 4.3,
    background: '#e7edf7',
    sky: '#dcecff',
    spawn: { x: 1, y: 15 },
    walk: [[0, 0, 23, depth]],
    solid,
    stations,
    pois: [],
    props,
  };
}

function disposeObject(object) {
  object.traverse(o => {
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
    this.activityLog = new Map();
    this.screenDesk = null;
    this.screenMesh = null;
    this.screenRefs = null;
    this.screenReturnFocus = null;
    this.screenInert = [];
    this.playing = false;
    this.raycaster = new THREE.Raycaster();
    this.onFrame = () => this.updatePins();
    // 切换语言后重绘屏幕贴图与弹窗文案。
    this.offLang = onLangChange(() => this.paintScreens(true));
    this.canvas.addEventListener('pointerdown', e => {
      this.downPoint = { x: e.clientX, y: e.clientY };
    });
    if (this.gl) {
      this.gl.toneMappingExposure = 1.15;
      this.gl.setClearColor('#e7edf7');
      this.hemi.color.set('#f2f8ff');
      this.hemi.groundColor.set('#a2b2ca');
      this.sun.color.set('#ffffff');
      this.sun.shadow.mapSize.set(2048, 2048);
      this.sun.shadow.radius = 4;
    }
  }

  fitCamera3D(reset) {
    if (!this.camera || !this.controls || !this.sun) return;
    const narrow = this.cw < 850;
    const extraDepth = Math.max(0, this.plan.D - 20);
    const target = new THREE.Vector3(narrow ? 10.2 : 12.65, 0.35, (narrow ? 8.8 : 8.15) + extraDepth * 0.45);
    if (reset || !this.fitted) {
      this.camera.position.copy(target).add(new THREE.Vector3(22, 21.5, 22));
      this.controls.target.copy(target);
      this.camera.zoom = 1;
      this.fitted = true;
    }
    const height = (narrow ? 21 : Math.max(19.5, (28.0 * this.ch) / this.cw)) + extraDepth * 0.85;
    const width = (height * this.cw) / this.ch;
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.sun.position.set(5, 19, 7);
    this.sun.target.position.set(11, 0, 9 + extraDepth * 0.5);
    const shadowSize = 18 + extraDepth;
    Object.assign(this.sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 55 + extraDepth });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  build() {
    super.build();
    this.floorMark('COORDINATION', 4.8, 7.1, 3.9, 0.55);
    this.floorMark('AGENT WORKSPACE', 4.5, 14.0, 4.4, 0.5);
    this.floorMark('COLLABORATION LANE', 11.0, 12.6, 5.2, 0.55);
    this.floorMark('VERIFICATION', 16.5, 9.0, 3.9, 0.5);
    const stripes = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.3), new THREE.MeshStandardMaterial({ color: '#f6faff', roughness: 0.9 }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -0.55;
      m.position.set(8.0 + i * 0.45, 0.03, 15.3);
      stripes.add(m);
    }
    this.room.add(stripes);
    // Match every decorated monitor face to its desk so the draw loop can
    // keep the screens alive (and use them as data-transfer endpoints).
    this.screens = new Map();
    this.screenMeshes = [];
    this.screenList = [];
    const screenDistance = new Map();
    for (const screen of this.sceneScreens || []) {
      if (screen.kind !== 'computerScreen') continue;
      let best = null,
        bestDistance = Infinity;
      for (const desk of this.plan.desks) {
        const distance = Math.hypot(screen.x - desk.seat.x, screen.z - desk.seat.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = desk;
        }
      }
      if (best && bestDistance < 2.2) {
        screen.mesh.userData.desk = best;
        this.screenMeshes.push(screen.mesh);
        this.screenList.push({ desk: best, mesh: screen.mesh, record: screen });
        if (!screenDistance.has(best) || bestDistance < screenDistance.get(best)) {
          screenDistance.set(best, bestDistance);
          this.screens.set(best, screen.mesh);
        }
      }
    }
    this.routeId = null;
    this.makeRoute(this.selectedId || this.rootId);
    this.paintScreens(true);
  }

  floorMark(text, x, z, w, h) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 128;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, 768, 128);
    c.fillStyle = '#899eb9';
    c.font = '600 38px "Segoe UI",sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(text, 384, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.036, z);
    this.room.add(m);
  }

  actorFor(p) {
    const a = super.actorFor(p);
    if (!a) return null;
    if (!a.demoScale) {
      a.obj.scale.multiplyScalar(1.65);
      if (a.head) a.head.scale.multiplyScalar(0.78);
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
    for (const p of this.people.values()) p.desk.pose = 'sit';
    if (this.selectedId && !this.people.has(this.selectedId)) this.selectedId = rootId;
    this.makeRoute(this.selectedId || rootId);
    this.paintScreens();
  }

  bubble() {}

  screenPoint(person) {
    const seat = person.desk.seat;
    return new THREE.Vector3(seat.x + 0.1, 1.3, seat.y - 1.15);
  }

  pathBetween(from, to) {
    if (!from?.desk || !to?.desk || from === to) return null;
    const start = this.screenPoint(from),
      end = this.screenPoint(to);
    const distance = start.distanceTo(end);
    const mid = new THREE.Vector3((start.x + end.x) / 2, Math.max(start.y, end.y) + 0.75 + Math.min(1.3, distance * 0.1), (start.z + end.z) / 2 + 0.35);
    return new THREE.CatmullRomCurve3([start, mid, end], false, 'centripetal', 0.5);
  }

  addRouteLine(group, curve) {
    for (const [radius, color, opacity] of [
      [0.18, '#42c8ff', 0.16],
      [0.065, '#0870ff', 0.94],
    ]) {
      group.add(
        new THREE.Mesh(
          new THREE.TubeGeometry(curve, 100, radius, 6, false),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, depthTest: false }),
        ),
      );
    }
    const dash = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(curve.getPoints(70)),
      new THREE.LineDashedMaterial({ color: '#e9fbff', dashSize: 0.12, gapSize: 0.18, linewidth: 2 }),
    );
    dash.computeLineDistances();
    group.add(dash);
  }

  clearEventRoutes() {
    for (const route of this.eventRoutes || []) {
      this.scene?.remove(route.group);
      disposeObject(route.group);
    }
    this.eventRoutes = [];
  }

  makeRoute(id) {
    const person = this.people?.get(id);
    if (!this.loaded || !this.room || !person) return;
    const parent = this.people.get(person.s.parentId);
    const signature = [id, person.desk.seat.x, person.desk.seat.y, parent?.s.id, parent?.desk.seat.x, parent?.desk.seat.y].join(':');
    if (this.routeId === id && this.routeSignature === signature) return;
    if (this.routeGroup) {
      this.scene.remove(this.routeGroup);
      disposeObject(this.routeGroup);
    }
    this.routeId = id;
    this.routeSignature = signature;
    this.routeGroup = new THREE.Group();
    this.scene.add(this.routeGroup);
    const s = person.desk.seat;
    this.routeCurve = this.pathBetween(parent, person);
    this.packet = null;
    if (this.routeCurve) {
      this.addRouteLine(this.routeGroup, this.routeCurve);
      this.packet = null;
    }
    for (const dx of [-1, 1])
      for (const dz of [-1, 1]) {
        const x = s.x + dx * 1.95,
          z = s.y - 0.4 + dz * 1.4;
        for (const points of [
          [new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x - dx * 0.6, 0.05, z)],
          [new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x, 0.05, z - dz * 0.5)],
          [new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x, 0.7, z)],
        ]) {
          const curve = new THREE.LineCurve3(points[0], points[1]);
          this.routeGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 1, 0.035, 6, false), new THREE.MeshBasicMaterial({ color: '#08a0ff' })));
        }
      }
  }

  select(id, focus = false) {
    this.selectedId = id;
    this.makeRoute(id);
    if (focus && this.cw < 850) {
      const p = this.people.get(id);
      if (p && this.camera) {
        const next = new THREE.Vector3(p.x, 0.3, p.y);
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
      const v = new THREE.Vector3(p.x, 2.2, p.y - 0.4).project(this.camera);
      const x = (v.x + 1) * 0.5 * this.cw,
        y = (1 - v.y) * 0.5 * this.ch;
      pin.style.left = x + 'px';
      pin.style.top = y + 'px';
      pin.hidden = v.z > 1 || x < -40 || x > this.cw + 40 || y < 70 || y > this.ch - 70;
    }
  }

  animateEvent(event) {
    this.remember(event);
    if (event.type === 'report') super.animateEvent(event);
    this.flows = [];
    if (this.reduced || !this.loaded || !['assign', 'message', 'report'].includes(event.type)) return;
    const from = this.people.get(event.sessionId);
    const to = this.people.get(event.type === 'report' ? from?.s.parentId : event.targetId);
    const curve = this.pathBetween(from, to);
    if (!curve) return;
    const group = new THREE.Group();
    this.addRouteLine(group, curve);
    const now = performance.now();
    const packets = [];
    for (let i = 0; i < 3; i++) {
      const packet = new THREE.Mesh(
        new THREE.SphereGeometry(0.105, 12, 8),
        new THREE.MeshBasicMaterial({ color: i ? '#bfefff' : '#ffffff', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }),
      );
      packet.visible = false;
      group.add(packet);
      packets.push(packet);
    }
    this.scene.add(group);
    for (const p of [from, to]) {
      if (!p?.desk) continue;
      for (const entry of this.screenList || []) {
        if (entry.desk === p.desk) entry.mesh.userData.flashUntil = now + 900;
      }
    }
    this.eventRoutes.push({ group, curve, packets, start: now });
    while (this.eventRoutes.length > 12) {
      const old = this.eventRoutes.shift();
      this.scene.remove(old.group);
      disposeObject(old.group);
    }
  }

  setReduced(value) {
    super.setReduced(value);
    if (value) this.clearEventRoutes();
  }

  step(dt) {
    if (this.playing) super.step(dt);
  }

  syncActors(dt) {
    if (this.hemi) this.hemi.intensity = 1.6;
    if (this.sun) this.sun.intensity = 2.0;
    super.syncActors(this.playing ? dt : 0);
  }

  pointer(e, click) {
    if (this.screenModal) return;
    if (!click) {
      if (e.buttons) return;
      if (!this.camera || !this.loaded) return;
      const box = this.canvas.getBoundingClientRect();
      this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - box.left) / box.width) * 2 - 1, 1 - ((e.clientY - box.top) / box.height) * 2), this.camera);
      this.canvas.style.cursor = this.raycaster.intersectObjects(this.screenMeshes || [], false).length ? 'pointer' : '';
      return;
    }
    if (!this.camera || !this.loaded) return;
    if (this.downPoint && Math.hypot(e.clientX - this.downPoint.x, e.clientY - this.downPoint.y) > 6) return;
    const rect = this.canvas.getBoundingClientRect();
    this.raycaster.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((e.clientY - rect.top) / rect.height) * 2),
      this.camera,
    );
    const actorHits = this.raycaster.intersectObjects(
      [...this.actors.values()].map(a => a.obj),
      true,
    );
    const screenHits = this.raycaster.intersectObjects(this.screenMeshes || [], false);
    const screenHit = screenHits[0];
    if (screenHit && (!actorHits[0] || screenHit.distance < actorHits[0].distance)) {
      const desk = screenHit.object.userData.desk;
      if (desk) {
        this.openScreen(desk, screenHit.object);
        return;
      }
    }
    for (const hit of actorHits) {
      let object = hit.object;
      while (object && !object.userData.agentId) object = object.parent;
      if (object?.userData.agentId) {
        this.selectCallback(object.userData.agentId);
        return;
      }
    }
    const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const point = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(floor, point)) {
      for (const person of this.people.values()) {
        const s = person.desk.seat;
        if (Math.abs(point.x - s.x) < 2.1 && Math.abs(point.z - s.y + 0.5) < 1.8) {
          this.selectCallback(person.s.id);
          return;
        }
      }
    }
  }

  screenStatus(status) {
    const colors = {
      working: '#5ee0a0',
      tool: '#5ee0a0',
      typing: '#5ee0a0',
      thinking: '#f0c35e',
      done: '#5ee0a0',
      waiting: '#f0c35e',
      waiting_agents: '#f0c35e',
      error: '#ff7a6b',
      interrupted: '#f0a35e',
      closed: '#8fa6c6',
      idle: '#8fa6c6',
      unknown: '#8fa6c6',
    };
    const key = 'scene.screen.' + status;
    return [hasKey(key) ? t(key) : String(status || t('scene.screen.unknown')), colors[status] || '#8fa6c6'];
  }

  remember(event) {
    const id = event.sessionId || event.targetId;
    if (!id) return;
    const key = 'scene.activity.' + event.type;
    const label = hasKey(key) ? t(key) : t('scene.activity.event');
    const list = this.activityLog.get(id) || [];
    const at = Number(event.at);
    const time = new Date(Number.isFinite(at) && at > 0 ? at : Date.now()).toLocaleTimeString(locale(), { hour12: false });
    list.unshift({ time, label, text: event.preview || event.title || '' });
    this.activityLog.set(id, list.slice(0, 6));
  }

  screenInfo(person) {
    if (!person) return { empty: true };
    const s = person.s;
    const [statusText, statusColor] = this.screenStatus(s.status);
    return {
      name: s.name,
      code: s.code,
      statusText,
      statusColor,
      task: s.task || s.title || t('scene.screen.waitingTask'),
      context: s.file && s.file !== t('common.notRecorded') ? s.file : '',
      log: this.activityLog.get(s.id) || [],
      updated: new Date().toLocaleTimeString(locale(), { hour12: false }),
    };
  }

  paintScreens(force = false) {
    for (const entry of this.screenList || []) {
      const person = [...this.people.values()].find(p => p.desk === entry.desk) || null;
      const info = this.screenInfo(person);
      const sig = person ? [person.s.id, person.s.status, person.s.task, person.s.file, info.log[0]?.time || ''].join('|') : 'empty';
      if (!force && entry.sig === sig) continue;
      entry.sig = sig;
      const canvas = this.screenCanvas(entry.record.seed, 512, info);
      entry.record.canvas = canvas;
      const tex = entry.mesh.userData.screenTexture;
      if (tex) {
        tex.image = canvas;
        tex.needsUpdate = true;
      }
    }
    if (this.screenModal) this.updateScreenModal();
  }

  screenText(info, person) {
    if (!person) return [t('scene.screen.unassigned'), '', t('scene.screen.waitingSeat')].join('\n');
    const [statusText] = this.screenStatus(person.s.status);
    const lines = [
      person.s.name + ' · ' + (person.s.role || t('common.agent')),
      t('scene.screen.statusLine', { status: statusText }),
      t('scene.screen.taskLine', { task: info.task || t('scene.screen.waitingTask') }),
      info.context ? t('scene.screen.contextLine', { value: info.context }) : t('scene.screen.contextNone'),
      '',
      t('scene.screen.recent'),
    ];
    if (info.log.length) for (const item of info.log) lines.push(item.time + '  ' + item.label + '  ' + item.text);
    else lines.push(t('scene.screen.noEvents'));
    return lines.join('\n');
  }

  updateScreenModal() {
    const refs = this.screenRefs;
    if (!refs || !this.screenDesk) return;
    const person = [...this.people.values()].find(p => p.desk === this.screenDesk) || null;
    const info = this.screenInfo(person);
    const [statusText, statusColor] = this.screenStatus(person?.s.status);
    refs.name.textContent = person?.s.name || t('scene.screen.idleSeat');
    refs.sub.textContent = person ? [person.s.role || t('common.agent'), statusText].filter(Boolean).join(' · ') : t('scene.screen.noAgentSeated');
    refs.dot.style.background = statusColor;
    refs.dot.style.boxShadow = '0 0 10px ' + statusColor;
    refs.card.dataset.status = person?.s.status || 'empty';
    const seed = Number(this.screenMesh?.userData?.screenSeed) || 0;
    refs.body.replaceChildren(this.screenCanvas(seed, 1280, info));
    refs.live.textContent = this.screenText(info, person);
    refs.meta.textContent = person
      ? [person.s.code || 'AGENT', info.context ? t('scene.screen.contextLine', { value: info.context }) : t('scene.screen.contextNone')].join(' · ')
      : t('scene.screen.unassigned');
    refs.task.textContent = person ? info.task : t('scene.screen.waitingSeat');
    refs.task.title = refs.task.textContent;
    refs.hint.textContent = t('scene.screen.escHint');
    refs.close.setAttribute('aria-label', t('scene.screen.closeAria'));
  }

  openScreenFor(agentId) {
    const person = this.people.get(agentId);
    if (!person?.desk) return false;
    const entry = (this.screenList || []).find(item => item.desk === person.desk);
    if (!entry) return false;
    this.openScreen(person.desk, entry.mesh);
    return true;
  }

  openScreen(desk, mesh) {
    if (this.screenModal) this.closeScreen();
    this.screenDesk = desk;
    this.screenMesh = mesh || (this.screenList || []).find(item => item.desk === desk)?.mesh || null;
    this.screenReturnFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'screen-modal';
    const card = document.createElement('div');
    card.className = 'screen-modal-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    const titleId = 'screen-modal-title-' + Math.random().toString(36).slice(2, 8);
    card.setAttribute('aria-labelledby', titleId);
    const header = document.createElement('header');
    const dot = document.createElement('span');
    dot.className = 'screen-modal-dot';
    const title = document.createElement('div');
    title.className = 'screen-modal-title';
    const name = document.createElement('strong');
    name.id = titleId;
    const sub = document.createElement('small');
    title.append(name, sub);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'screen-modal-close';
    close.setAttribute('aria-label', t('scene.screen.closeAria'));
    close.textContent = '×';
    header.append(dot, title, close);
    const body = document.createElement('div');
    body.className = 'screen-modal-body';
    const live = document.createElement('pre');
    live.className = 'screen-modal-live';
    const footer = document.createElement('footer');
    const meta = document.createElement('span');
    meta.className = 'screen-modal-meta';
    const task = document.createElement('span');
    task.className = 'screen-modal-task';
    const hint = document.createElement('span');
    hint.className = 'screen-modal-hint';
    hint.textContent = t('scene.screen.escHint');
    footer.append(meta, task, hint);
    card.append(header, body, live, footer);
    overlay.appendChild(card);
    this.screenRefs = { overlay, card, name, sub, dot, body, live, meta, task, hint, close };
    overlay.addEventListener('click', event => {
      if (event.target === overlay) this.closeScreen();
    });
    close.addEventListener('click', () => this.closeScreen());
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeScreen();
      } else if (event.key === 'Tab') {
        event.preventDefault();
        close.focus();
      } else if (event.key === '/') event.preventDefault();
    });
    this.screenEsc = event => {
      if (event.key === 'Escape' && this.screenModal) this.closeScreen();
    };
    window.addEventListener('keydown', this.screenEsc);
    this.screenInert = [...document.body.children].filter(el => el !== overlay && !['SCRIPT', 'STYLE', 'LINK'].includes(el.tagName));
    for (const el of this.screenInert) {
      el.dataset.screenInert = el.inert ? '1' : '0';
      el.inert = true;
    }
    document.body.appendChild(overlay);
    this.screenModal = overlay;
    this.updateScreenModal();
    close.focus();
  }

  closeScreen() {
    if (this.screenEsc) window.removeEventListener('keydown', this.screenEsc);
    this.screenEsc = null;
    if (this.screenModal) {
      this.screenModal.remove();
      this.screenModal = null;
    }
    for (const el of this.screenInert || []) {
      el.inert = el.dataset.screenInert === '1';
      delete el.dataset.screenInert;
    }
    this.screenInert = [];
    this.screenRefs = null;
    this.screenDesk = null;
    this.screenMesh = null;
    const back = this.screenReturnFocus;
    this.screenReturnFocus = null;
    if (back && back.isConnected) {
      try {
        back.focus({ preventScroll: true });
      } catch {}
    }
  }

  draw() {
    const now = performance.now();
    for (const route of this.eventRoutes || []) {
      const age = now - route.start;
      for (let i = 0; i < route.packets.length; i++) {
        const packet = route.packets[i];
        const t = (age - 120 - i * 240) / 1500;
        if (t < 0 || t > 1) {
          packet.visible = false;
          continue;
        }
        packet.visible = true;
        packet.position.copy(route.curve.getPoint(t));
        packet.scale.setScalar(1 - (0.3 * Math.max(0, t - 0.72)) / 0.28);
      }
      if (age >= 2200) {
        this.scene.remove(route.group);
        disposeObject(route.group);
      }
    }
    if (this.eventRoutes) this.eventRoutes = this.eventRoutes.filter(route => now - route.start < 2200);
    const result = super.draw();
    if (this.packet && this.routeCurve) {
      const t = this.reduced || !this.playing ? 0.58 : (performance.now() % 4500) / 4500;
      this.packet.position.copy(this.routeCurve.getPoint(t));
      this.packet.position.y += 0.09;
    }
    return result;
  }

  destroy() {
    this.offLang?.();
    this.closeScreen();
    this.clearEventRoutes();
    if (this.routeGroup) disposeObject(this.routeGroup);
    super.destroy();
  }
}
