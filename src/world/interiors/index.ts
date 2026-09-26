/**
 * Zoom interiors for one campus, built lazily the first time a view is opened
 * (this module is its own chunk — see world.ts). Each diorama sits at an
 * anchor in the campus's local space so it moves and turns with the campus:
 *
 * - offices:  floors inside the tower (the tower turns to glass);
 * - hall:     racks inside the server-hall block (the hall roofs lift away);
 * - power:    the substation and cooling towers already on the campus;
 * - lab:      a display case in front of the tower.
 */
import type { Object3D } from 'three';
import type { Model, Platform } from '../../data/schema';
import type { Campus } from '../campus/campus';
import { createHall, type Hall } from './hall';
import { createLab, type Lab } from './lab';
import { createOffices, type Offices } from './offices';

export type InteriorView = 'overview' | 'offices' | 'hall' | 'power' | 'lab';

export const INTERIOR_VIEWS: readonly InteriorView[] = [
  'overview',
  'offices',
  'hall',
  'power',
  'lab',
];

export interface InteriorFrame {
  /** Normalized load 0..1 (log scale of tokens/day). */
  load: number;
  /** Office occupancy 0..1 at the HQ's local hour. */
  occupancy: number;
  /** Traffic intensity (1 = daily average). */
  activity: number;
  time: number;
}

export interface Interiors {
  readonly view: InteriorView;
  show(view: InteriorView): void;
  update(f: InteriorFrame): void;
  /** Pickable model crystals while the lab is shown, else empty. */
  pickables(): readonly Object3D[];
  selectModel(id: string | null): void;
  /** Half the width of the lab display (for framing). */
  labHalfWidth(): number;
  dispose(): void;
}

/** The server-hall diorama is modelled at 16 × 15 units; this fits it inside the hall block. */
const HALL_SCALE = 0.7;

export function createInteriors(
  platform: Platform,
  campus: Campus,
  models: readonly Model[],
): Interiors {
  let view: InteriorView = 'overview';
  let offices: Offices | null = null;
  let hall: Hall | null = null;
  let lab: Lab | null = null;
  let selectedModel: string | null = null;
  const accent = platform.identity.palette.accent;

  function ensure(v: InteriorView): void {
    if (v === 'offices' && !offices) {
      offices = createOffices(campus.bodyHalf, accent);
      offices.group.visible = view === v;
      campus.group.add(offices.group);
    }
    if (v === 'hall' && !hall) {
      hall = createHall(platform);
      hall.group.position.copy(campus.anchors.halls);
      hall.group.scale.setScalar(HALL_SCALE);
      hall.group.visible = view === v;
      campus.group.add(hall.group);
    }
    if (v === 'lab' && !lab) {
      lab = createLab(models, accent);
      lab.group.position.copy(campus.anchors.lab);
      lab.select(selectedModel);
      lab.group.visible = view === v;
      campus.group.add(lab.group);
    }
  }

  return {
    get view() {
      return view;
    },
    show(v) {
      view = v;
      ensure(v);
      if (offices) offices.group.visible = v === 'offices';
      if (hall) hall.group.visible = v === 'hall';
      if (lab) lab.group.visible = v === 'lab';
      campus.setInterior(v);
    },
    update(f) {
      if (view === 'offices') offices?.update(f);
      else if (view === 'hall') hall?.update(f);
      else if (view === 'lab') lab?.update(f);
    },
    pickables() {
      return view === 'lab' && lab ? lab.pickables : [];
    },
    selectModel(id) {
      selectedModel = id;
      lab?.select(id);
    },
    labHalfWidth() {
      ensure('lab');
      return lab!.halfWidth;
    },
    dispose() {
      campus.setInterior('overview');
      for (const part of [offices, hall, lab]) {
        if (!part) continue;
        campus.group.remove(part.group);
        part.dispose();
      }
      offices = hall = lab = null;
    },
  };
}
