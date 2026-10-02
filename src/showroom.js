// Menu background: the selected car on a slowly turning studio turntable.

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CarModel } from './carModel.js';

export class Showroom {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07080b);
    this.scene.fog = new THREE.Fog(0x07080b, 14, 34);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    this.visible = true;
    this.angle = 0.6;

    const floorTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 512;
      const g = c.getContext('2d');
      const grd = g.createRadialGradient(256, 256, 30, 256, 256, 256);
      grd.addColorStop(0, '#2a2c33');
      grd.addColorStop(0.55, '#14151a');
      grd.addColorStop(1, '#07080b');
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 512);
      g.strokeStyle = 'rgba(225,38,45,0.55)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(256, 256, 150, 0, Math.PI * 2);
      g.stroke();
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 64), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.35, metalness: 0.4 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const key = new THREE.SpotLight(0xffffff, 380, 40, 0.55, 0.6, 1.5);
    key.position.set(5, 9, 4);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    const rim = new THREE.SpotLight(0xe1262d, 260, 40, 0.6, 0.7, 1.5);
    rim.position.set(-6, 4, -6);
    this.scene.add(rim);
    const fill = new THREE.SpotLight(0x6fa8ff, 120, 40, 0.7, 0.8, 1.5);
    fill.position.set(-5, 6, 6);
    this.scene.add(fill);
    this.scene.add(new THREE.HemisphereLight(0x8899aa, 0x101014, 0.4));
    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
  }

  setCar(spec, color) {
    if (this.model) {
      this.turntable.remove(this.model.root);
      this.model.dispose();
    }
    this.model = new CarModel(spec, color, { number: 1, helmet: 0xffd200 });
    this.model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.model.root.position.z = -(spec.a - spec.b) / 2;
    this.turntable.add(this.model.root);
  }

  setVisible(v) {
    this.visible = v;
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt) {
    this.angle += dt * 0.25;
    this.turntable.rotation.y = this.angle;
    const wide = this.camera.aspect > 1.3;
    this.camera.position.set(0, 2.3, 11);
    this.camera.lookAt(0, 0.6, 0);
    // Wide screens: the car sits to the right of the menu.
    this.turntable.position.x = wide ? 2.7 : 0;
    this.turntable.position.z = wide ? -1 : 0;
    if (this.model) this.model.update(dt, { steerRoad: Math.sin(this.angle * 0.7) * 0.35 });
  }

  render() {
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.render(this.scene, this.camera);
  }
}
