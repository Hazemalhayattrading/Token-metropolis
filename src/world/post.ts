/** Post-processing: tasteful bloom on emissive highlights, then tone mapping and sRGB output. */
import { Vector2, type Camera, type Scene, type WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface Post {
  render(): void;
  setSize(w: number, h: number, pixelRatio: number): void;
  setBloom(on: boolean): void;
  dispose(): void;
}

export function createPost(renderer: WebGLRenderer, scene: Scene, camera: Camera): Post {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.55, 0.5, 0.84);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  return {
    render: () => composer.render(),
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      // bloom at half resolution is visually identical and much cheaper
      bloom.resolution.set(w / 2, h / 2);
    },
    setBloom(on) {
      bloom.enabled = on;
    },
    dispose() {
      bloom.dispose();
      composer.dispose();
    },
  };
}
