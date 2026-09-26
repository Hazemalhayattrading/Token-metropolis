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
import { Group, type Object3D } from 'three';
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
  /** Where the office floors are (for framing). */
  officeFrame(): { y: number; radius: number };
  /** Pick targets of the hidden details in the view shown (see `Decorate`), else empty. */
  discoveryPickables(): readonly Object3D[];
  /** The groups built so far (for shader pre-compilation). */
  groups(): Object3D[];
  dispose(): void;
}

/**
 * Adds extra props (the hidden details, src/world/discoveries.ts) to a view's group right after it
 * is built, and returns their pick targets. The power view has no diorama of its own, so it gets an
 * empty group at the campus origin, shown only in that view.
 */
export type Decorate = (
  view: Exclude<InteriorView, 'overview'>,
  group: Group,
) => readonly Object3D[];

/** The server-hall diorama is modelled at 16 × 15 units; this fits it inside the hall block. */
const HALL_SCALE = 0.7;

export function createInteriors(
  platform: Platform,
  campus: Campus,
  models: readonly Model[],
  /** Tower height the interiors are laid out for (interiors are always shown at log scale). */
  towerHeight: number,
  decorate?: Decorate,
): Interiors {
  let view: InteriorView = 'overview';
  let offices: Offices | null = null;
  let hall: Hall | null = null;
  let lab: Lab | null = null;
  let power: Group | null = null;
  const extras = new Map<InteriorView, readonly Object3D[]>();
  const dress = (v: Exclude<InteriorView, 'overview'>, g: Group) => {
    if (decorate) extras.set(v, decorate(v, g));
  };
  let selectedModel: string | null = null;
  const accent = platform.identity.palette.accent;

  function ensure(v: InteriorView): void {
    if (v === 'offices' && !offices) {
      offices = createOffices({
        half: campus.bodyHalf,
        accent,
        fits: (x, y, z) => campus.insideBody(x, y, z, towerHeight),
      });
      offices.group.visible = view === v;
      campus.group.add(offices.group);
      dress('offices', offices.group);
    }
    if (v === 'hall' && !hall) {
      hall = createHall(platform);
      hall.group.position.copy(campus.anchors.halls);
      hall.group.scale.setScalar(HALL_SCALE);
      hall.group.visible = view === v;
      campus.group.add(hall.group);
      dress('hall', hall.group);
    }
    if (v === 'lab' && !lab) {
      lab = createLab(models, accent);
      lab.group.position.copy(campus.anchors.lab);
      lab.select(selectedModel);
      lab.group.visible = view === v;
      campus.group.add(lab.group);
      dress('lab', lab.group);
    }
    if (v === 'power' && !power && decorate) {
      power = new Group();
      power.name = 'power-extras';
      power.visible = view === v;
      campus.group.add(power);
      dress('power', power);
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
      if (power) power.visible = v === 'power';
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
    discoveryPickables() {
      return extras.get(view) ?? [];
    },
    labHalfWidth() {
      ensure('lab');
      return lab!.halfWidth;
    },
    officeFrame() {
      ensure('offices');
      return offices!.frame;
    },
    groups() {
      const built = [offices, hall, lab].filter((p) => p !== null).map((p) => p.group);
      return power ? [...built, power] : built;
    },
    dispose() {
      campus.setInterior('overview');
      for (const part of [offices, hall, lab]) {
        if (!part) continue;
        campus.group.remove(part.group);
        part.dispose();
      }
      offices = hall = lab = null;
      // Detaching the power group releases its props (as with the other groups).
      if (power) campus.group.remove(power);
      power = null;
      extras.clear();
    },
  };
}
