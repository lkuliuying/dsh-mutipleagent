import * as THREE from 'three';
import { TeamOffice } from './team-office.js';
import { hasKey, locale, onLangChange, t } from './i18n.mjs';

// 办公室平面：4 列 × 3 行「对坐工位」，每组一张共享长桌、两位成员面对面。
const POD_X = [4.5, 9.1, 13.7, 18.3];
const POD_Z = [6.2, 11.2, 16.2];
const ROOM_W = 23;
const ROOM_D = 21;
const COLORS = { blue: '#1769e8', white: '#f6f9fe', steel: '#d2dce8', navy: '#233d61' };
const model = (f, x, y, w, d, options = {}) => ({ f, x, y, w, d, ...options });
const box = (x, y, w, d, h, color, y0 = 0) => ({ special: 'box', x, y, w, d, h, color, y0, abs: true });

/**
 * 一张共享长桌 + 两位面对面的成员。
 * 北侧成员朝南（yaw 0）、南侧成员朝北（yaw 180），显示器在桌心背靠背。
 */
function facingPod({ props, solid, stations }, x, zc) {
  props.push({ special: 'floor', x: x - 2.05, y: zc - 2.0, w: 4.1, d: 4.0, color: '#e4ebf5', color2: '#dde6f1', y0: 0.02 });
  // 白台体 + 浅色台面 + 蓝色前后沿 + 两侧端板
  props.push(box(x - 1.65, zc - 0.8, 3.3, 1.6, 0.9, '#f7faff'));
  props.push(box(x - 1.7, zc - 0.85, 3.4, 1.7, 0.06, '#eaf1fb', 0.9));
  props.push(box(x - 1.7, zc - 0.85, 3.4, 0.14, 0.09, '#176de8', 0.9));
  props.push(box(x - 1.7, zc + 0.71, 3.4, 0.14, 0.09, '#176de8', 0.9));
  props.push(box(x - 1.7, zc - 0.85, 0.07, 1.7, 0.96, '#397bd5'));
  props.push(box(x + 1.63, zc - 0.85, 0.07, 1.7, 0.96, '#397bd5'));
  // 桌心背靠背主屏：北屏朝北（面向北侧成员），南屏朝南。
  props.push(model('computerScreen', x - 0.64, zc - 0.34, 1.02, 0.34, { h: 0.62, y0: 0.96, abs: true, rot: 180 }));
  props.push(model('computerScreen', x - 0.64, zc + 0.34, 1.02, 0.34, { h: 0.62, y0: 0.96, abs: true, rot: 0 }));
  // 侧屏（略微内倾）
  props.push(model('computerScreen', x + 0.56, zc - 0.5, 0.74, 0.3, { h: 0.5, y0: 0.96, abs: true, rot: 192 }));
  props.push(model('computerScreen', x + 0.56, zc + 0.5, 0.74, 0.3, { h: 0.5, y0: 0.96, abs: true, rot: 12 }));
  // 键鼠各贴近自己一侧
  props.push(model('computerKeyboard', x - 0.62, zc - 0.8, 0.72, 0.22, { y0: 0.96, abs: true }));
  props.push(model('computerKeyboard', x - 0.62, zc + 0.58, 0.72, 0.22, { y0: 0.96, abs: true, rot: 180 }));
  props.push(model('computerMouse', x + 0.12, zc - 0.78, 0.13, 0.18, { y0: 0.96, abs: true }));
  props.push(model('computerMouse', x + 0.12, zc + 0.6, 0.13, 0.18, { y0: 0.96, abs: true, rot: 180 }));
  // 桌心绿植与文件，填补两国之间的空隙
  props.push(model('plantSmall1', x + 1.25, zc - 0.16, 0.32, 0.32, { h: 0.42, y0: 0.96, abs: true }));
  props.push(model('books', x - 1.42, zc + 0.16, 0.5, 0.3, { h: 0.16, y0: 0.96, abs: true }));
  props.push(model('books', x + 1.24, zc + 0.4, 0.32, 0.22, { h: 0.14, y0: 0.96, abs: true }));
  // 两把椅子：北侧朝南、南侧朝北
  props.push(model('chairDesk', x - 0.375, zc - 1.75, 0.75, 0.8, { h: 1.0, rot: 0 }));
  props.push(model('chairDesk', x - 0.375, zc + 0.95, 0.75, 0.8, { h: 1.0, rot: 180 }));
  for (const [chairX, chairZ, yaw] of [
    [x - 0.375, zc - 1.75, 0],
    [x - 0.375, zc + 1.35, 180],
  ]) {
    stations.push({ x: chairX + 0.375, y: chairZ + 0.4, yaw, pose: 'sit' });
  }
  solid.push([x - 1.7, zc - 0.85, 3.4, 1.7]);
}

export function collaborationScene(count = 4, source = 'codex') {
  const props = [
    { special: 'floor', x: -200, y: -210, w: 440, d: 440, color: '#dde5ef', color2: '#d6dfeb', tile: 8 },
    { special: 'floor', x: 0.1, y: 0.1, w: ROOM_W - 0.4, d: ROOM_D - 0.5, color: '#e9edf3', color2: '#dee5ee', tile: 4.2, y0: 0.012 },
    {
      special: 'wall',
      axis: 'x',
      x: -1,
      y: 0.05,
      len: ROOM_W + 2,
      h: 4.3,
      color: '#e7eef7',
      holes: [
        [1.1, 4.5, 1.3, 3.8],
        [7.4, 4.5, 1.3, 3.8],
        [13.6, 4.5, 1.3, 3.8],
        [19.2, 3.5, 1.3, 3.8],
      ],
      frame: '#c3cfdf',
    },
    {
      special: 'wall',
      axis: 'z',
      x: 0.05,
      y: 0,
      len: ROOM_D,
      h: 3.4,
      color: '#e4ebf5',
      holes: [
        [2.4, 3, 1.1, 2.9],
        [8.0, 3, 1.1, 2.9],
        [14.0, 3, 1.1, 2.9],
      ],
      frame: '#c7d2e1',
    },
    box(0, 0.15, ROOM_W - 1, 0.1, 0.12, '#bbcbdc'),
    box(0.15, 0, 0.1, ROOM_D - 1, 0.12, '#bbcbdc'),
  ];
  const solid = [];
  const stations = [];

  // 全部 12 组对坐工位铺满房间；主 Agent 与第一位子 Agent 落在同一组、面对面。
  for (const zc of POD_Z) {
    for (const x of POD_X) facingPod({ props, solid, stations }, x, zc);
  }
  // 人数超过 24 座时的兜底：后方追加简易单人工位，保证不丢成员。
  for (let slot = stations.length; slot < count; slot++) {
    const extra = slot - stations.length;
    const x = POD_X[extra % POD_X.length];
    const y = POD_Z[POD_Z.length - 1] + 3.4;
    props.push(box(x - 1.65, y - 1.65, 3.3, 1.0, 0.92, '#f7faff'));
    props.push(box(x - 1.7, y - 1.7, 3.4, 1.1, 0.08, COLORS.blue, 0.92));
    props.push(model('computerScreen', x - 0.6, y - 1.5, 1.0, 0.35, { h: 0.62, y0: 1.0, abs: true }));
    props.push(model('chairDesk', x - 0.375, y - 0.4, 0.75, 0.8, { h: 1.0, rot: 180 }));
    solid.push([x - 1.7, y - 1.7, 3.4, 1.1]);
    stations.push({ x, y: y + 0.35, yaw: 180, pose: 'sit' });
  }

  // 前区：玻璃会议室 + 设备柜
  props.push(
    { special: 'floor', x: 1.2, y: 1.1, w: 5.6, d: 3.0, color: '#dbe6f2', color2: '#dbe6f2', y0: 0.03 },
    { special: 'glass', x: 6.85, y: 1.1, w: 0.05, d: 3.0, h: 2.5, abs: true },
    box(6.8, 1.1, 0.12, 3.0, 0.07, '#9cacbf', 2.5),
    box(6.8, 1.1, 0.1, 0.1, 2.5, '#becddd'),
    box(6.8, 4.0, 0.1, 0.1, 2.5, '#becddd'),
    model('table', 1.9, 1.7, 3.2, 1.5, { h: 0.86, stretch: true }),
    model('laptop', 3.1, 2.1, 0.7, 0.6, { y0: 0.88, abs: true, rot: 180 }),
    model('computerScreen', 4.2, 4.42, 0.92, 0.3, { h: 0.56, y0: 0.88, abs: true, rot: 180 }),
    model('computerKeyboard', 4.15, 4.15, 0.66, 0.2, { y0: 0.88, abs: true }),
    model('computerMouse', 4.85, 4.15, 0.12, 0.17, { y0: 0.88, abs: true }),
    model('chairModernCushion', 2.6, 3.5, 0.65, 0.7, { rot: 180 }),
    model('chairModernCushion', 2.6, 1.0, 0.65, 0.7),
    model('chairModernCushion', 4.0, 3.5, 0.65, 0.7, { rot: 180 }),
    model('chairModernCushion', 4.0, 1.0, 0.65, 0.7),
    model('pottedPlant', 6.3, 4.1, 0.6, 0.6, { h: 1.5 }),
  );
  solid.push([1.9, 1.7, 3.2, 1.5], [6.8, 1.1, 0.12, 2.9]);
  for (const [sx, sz] of [
    [9.6, 0.9],
    [11.5, 0.9],
    [15.4, 0.9],
    [17.3, 0.9],
    [21.4, 2.0],
  ]) {
    props.push(box(sx, sz, 1.7, 0.95, 2.6, '#e9eff6'));
    for (const dx of [0, 1.63]) props.push(box(sx + dx, sz, 0.07, 0.95, 2.7, COLORS.blue));
    for (const h of [0.18, 0.72, 1.26, 1.8, 2.34]) {
      props.push(box(sx + 0.12, sz + 0.92, 1.46, 0.05, 0.35, '#455b78', h));
      props.push({ special: 'glow', x: sx + 0.22, y: sz + 0.975, y0: h + 0.12, w: 0.12, d: 0.025, h: 0.035, color: '#52b9ff', intensity: 1.0, abs: true });
    }
    solid.push([sx, sz, 1.7, 0.95]);
  }
  // 左墙：书架 + 茶水吧
  props.push(
    model('bookcaseOpen', 0.45, 3.2, 0.5, 2.6, { h: 1.8 }),
    model('books', 0.55, 3.4, 0.35, 2.2, { h: 0.3, y0: 1.0, abs: true }),
    model('kitchenCabinet', 0.45, 8.2, 1.5, 3.6, { h: 1, stretch: true }),
    model('kitchenCoffeeMachine', 0.5, 8.8, 0.6, 0.55, { h: 0.65, y0: 1.01, abs: true }),
    model('kitchenSink', 0.55, 10.6, 0.9, 0.7, { h: 0.15, y0: 1.01, abs: true }),
    model('pottedPlant', 0.9, 5.8, 0.55, 0.55, { h: 1.4 }),
    model('pottedPlant', 0.9, 13.2, 0.6, 0.6, { h: 1.5 }),
  );
  // 右墙：资料柜与档案架
  props.push(
    model('bookcaseOpen', 21.3, 6.0, 0.55, 3.0, { h: 1.9 }),
    model('books', 21.4, 6.2, 0.4, 2.6, { h: 0.32, y0: 1.05, abs: true }),
    model('bookcaseOpen', 21.3, 11.4, 0.55, 3.0, { h: 1.9 }),
    model('books', 21.4, 11.6, 0.4, 2.6, { h: 0.32, y0: 1.05, abs: true }),
    model('pottedPlant', 21.2, 16.0, 0.65, 0.65, { h: 1.6 }),
    model('pottedPlant', 21.4, 19.1, 0.6, 0.6, { h: 1.4 }),
  );
  // 后区：休息角
  props.push(
    model('loungeSofa', 8.2, 19.2, 3.8, 1.3, { h: 1.05 }),
    model('tableCoffee', 8.9, 17.9, 2.0, 0.8, { h: 0.5 }),
    model('books', 9.3, 18.1, 0.5, 0.3, { h: 0.18, y0: 0.52, abs: true }),
    model('pottedPlant', 6.2, 19.3, 0.7, 0.7, { h: 1.5 }),
    model('cardboardBoxClosed', 12.6, 19.6, 0.55, 0.5, { h: 0.45 }),
    {
      special: 'sign',
      x: 4.2,
      y: 0.12,
      z: 3.1,
      w: 3.0,
      h: 0.64,
      text: t(source === 'harness' ? 'scene.sign.harness' : 'scene.sign.codex'),
      bg: '#f0f5fc',
      fg: '#265a9d',
    },
    { special: 'sign', x: 17.4, y: 0.12, z: 3.1, w: 3.2, h: 0.65, text: t('scene.sign.agents'), bg: '#edf4fe', fg: '#3d6591' },
  );
  return {
    W: ROOM_W,
    D: ROOM_D,
    viewH: 4.3,
    background: '#dde5ef',
    sky: '#dcecff',
    spawn: { x: 1, y: 18.4 },
    walk: [[0, 0, ROOM_W, ROOM_D]],
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
  constructor(root, { onSelect, reduced = false, pins, pinFloor, count = 4, live = false, source = 'codex' }) {
    super(root, { count, onSelect, reduced, live, scene: collaborationScene(count, source) });
    this.pins = pins;
    // 顶部浮层（协作统计卡等）会盖住 pin，给它一条不能被越过的上边线。
    this.pinFloor = typeof pinFloor === 'function' ? pinFloor : () => 70;
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
      this.gl.setClearColor('#dde5ef');
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
    // 房间铺满 23×21，镜头对准中心并整体拉远，让整层办公室都入画。
    const target = new THREE.Vector3(narrow ? 10.6 : 11.5, 0.35, narrow ? 10.4 : 11.5);
    if (reset || !this.fitted) {
      this.camera.position.copy(target).add(new THREE.Vector3(24, 23.5, 24));
      this.controls.target.copy(target);
      this.camera.zoom = 1;
      this.fitted = true;
    }
    const height = narrow ? 32 : Math.max(31, (36.0 * this.ch) / this.cw);
    const width = (height * this.cw) / this.ch;
    Object.assign(this.camera, { left: -width / 2, right: width / 2, top: height / 2, bottom: -height / 2 });
    this.camera.lookAt(this.controls.target);
    this.camera.updateProjectionMatrix();
    this.sun.position.set(3, 22, 5);
    this.sun.target.position.set(11.5, 0, 10.5);
    const shadowSize = 22;
    Object.assign(this.sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 72 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  build() {
    super.build();
    this.floorMark('COORDINATION', 11.5, 3.35, 5.0, 0.6);
    this.floorMark('AGENT WORKSPACE', 4.5, 8.7, 4.4, 0.5);
    this.floorMark('COLLABORATION LANE', 15.5, 13.7, 5.2, 0.55);
    this.floorMark('VERIFICATION', 11.5, 18.8, 3.9, 0.5);
    const stripes = new THREE.Group();
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 1.3), new THREE.MeshStandardMaterial({ color: '#f6faff', roughness: 0.9 }));
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -0.55;
      m.position.set(9.4 + i * 0.45, 0.03, 13.7);
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
    const floor = Math.max(70, this.pinFloor() || 0);
    // 先算锚点，再按 y 从上到下排开重叠的标签，避免对坐工位挤在一起看不出谁是谁。
    const entries = [];
    for (const pin of this.pins.children) {
      const p = this.people.get(pin.dataset.agent);
      if (!p) continue;
      const v = new THREE.Vector3(p.x, 2.2, p.y - 0.4).project(this.camera);
      const x = (v.x + 1) * 0.5 * this.cw,
        y = (1 - v.y) * 0.5 * this.ch;
      const w = pin.offsetWidth || 110,
        h = pin.offsetHeight || 40;
      const anchor = Math.max(y, floor + h);
      entries.push({
        pin,
        x,
        y,
        w,
        h,
        top: anchor - h,
        bottom: anchor,
        hidden: v.z > 1 || x < -40 || x > this.cw + 40 || y < floor - 56 || y > this.ch - 70,
      });
    }
    entries.sort((a, b) => a.top - b.top || a.x - b.x);
    const placed = [];
    for (const entry of entries) {
      if (entry.hidden) continue;
      for (let guard = 0; guard < 6; guard += 1) {
        const hit = placed.find(
          other =>
            entry.x + entry.w / 2 > other.left - 8 && entry.x - entry.w / 2 < other.right + 8 && entry.top < other.bottom + 6 && entry.bottom > other.top - 6,
        );
        if (!hit) break;
        const shift = hit.bottom + 8 - entry.top;
        entry.top += shift;
        entry.bottom += shift;
      }
      placed.push({
        left: entry.x - entry.w / 2,
        right: entry.x + entry.w / 2,
        top: entry.top,
        bottom: entry.bottom,
      });
    }
    for (const entry of entries) {
      entry.pin.style.left = entry.x + 'px';
      entry.pin.style.top = entry.bottom + 'px';
      entry.pin.hidden = entry.hidden;
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
