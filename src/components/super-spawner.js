import { paths } from "../systems/userinput/paths";
import { addMedia } from "../utils/media-utils";
import { waitForEvent } from "../utils/async-utils";
import { ObjectContentOrigins } from "../object-types";

const COLLISION_FLAGS = require("aframe-physics-system/src/constants").COLLISION_FLAGS;

let nextGrabId = 0;
/**
 * Spawns networked objects when grabbed or when a specified event is fired.
 * @namespace network
 * @component super-spawner
 */
AFRAME.registerComponent("super-spawner", {
  schema: {
    /**
     * Source of the media asset the spawner will spawn when grabbed. This can be a gltf, video, or image, or a url that the reticiulm media API can resolve to a gltf, video, or image.
     */
    src: { default: "" },

    /**
     * Whether to use the Reticulum media resolution API to interpret the src URL (e.g. find a video URL for Youtube videos.)
     */
    resolve: { default: false },

    /**
     * Whether to resize the media on load.
     */
    resize: { default: false },

    /**
     * The template to use for this object
     */
    template: { default: "" },

    /**
     * Spawn the object at a custom position, rather than at the center of the spanwer.
     */
    useCustomSpawnPosition: { default: false },
    spawnPosition: { type: "vec3" },

    /**
     * Spawn the object with a custom orientation, rather than copying that of the spawner.
     */
    useCustomSpawnRotation: { default: false },
    spawnRotation: { type: "vec4" },

    /**
     * Spawn the object with a custom scale, rather than copying that of the spawner.
     */
    useCustomSpawnScale: { default: false },
    spawnScale: { type: "vec3" },

    /**
     * The events to emit for programmatically grabbing and releasing objects
     */
    grabEvents: { default: ["cursor-grab", "primary_hand_grab"] },
    releaseEvents: { default: ["cursor-release", "primary_hand_release"] },

    /**
     * The spawner will become invisible and ungrabbable for this ammount of time after being grabbed. This can prevent rapidly spawning objects.
     */
    spawnCooldown: { default: 1 },

    /**
     * Center the spawned object on the hand that grabbed it after it finishes loading. By default the object will be grabbed relative to where the spawner was grabbed
     */
    centerSpawnedObject: { default: false },

    /**
     * Optional event to listen for to spawn an object on the preferred superHand
     */
    spawnEvent: { type: "string" },

    /**
     * The superHand to use if an object is spawned via spawnEvent
     */
    superHand: { type: "selector" },

    /**
     * The cursor superHand to use if an object is spawned via spawnEvent
     */
    cursorSuperHand: { type: "selector" },

    /**
     * If true, will spawn the object at the cursor and animate it into the hand.
     */
    animateFromCursor: { type: "boolean" }
  },

  init() {
    this.heldEntities = new Map();
    this.cooldownTimeout = null;
    this.onGrabStart = this.onGrabStart.bind(this);
    this.onGrabEnd = this.onGrabEnd.bind(this);

    this.onSpawnEvent = this.onSpawnEvent.bind(this);

    this.sceneEl = document.querySelector("a-scene");

    this.el.setAttribute("hoverable-visuals", { cursorController: "#cursor-controller", enableSweepingEffect: false });
    this.tempSpawnHandPosition = new THREE.Vector3();
  },

  play() {
    this.el.addEventListener("grab-start", this.onGrabStart);
    this.el.addEventListener("grab-end", this.onGrabEnd);
    if (this.data.spawnEvent) {
      this.sceneEl.addEventListener(this.data.spawnEvent, this.onSpawnEvent);
    }
  },

  pause() {
    this.el.removeEventListener("grab-start", this.onGrabStart);
    this.el.removeEventListener("grab-end", this.onGrabEnd);
    if (this.data.spawnEvent) {
      this.sceneEl.removeEventListener(this.data.spawnEvent, this.onSpawnEvent);
    }

    if (this.cooldownTimeout) {
      clearTimeout(this.cooldownTimeout);
      this.cooldownTimeout = null;
      this.el.setAttribute("visible", true);
      this.el.classList.add("interactable");
    }
  },

  remove() {
    this.heldEntities.clear();
  },

  async onSpawnEvent() {
    const userinput = AFRAME.scenes[0].systems.userinput;
    const leftPose = userinput.get(paths.actions.leftHand.pose);
    const rightPose = userinput.get(paths.actions.rightHand.pose);
    const controllerCount = leftPose && rightPose ? 2 : leftPose || rightPose ? 1 : 0;
    const using6DOF = controllerCount > 1 && this.el.sceneEl.is("vr-mode");
    const hand = using6DOF ? this.data.superHand : this.data.cursorSuperHand;

    if (this.cooldownTimeout || !hand) {
      return;
    }

    const entity = addMedia(this.data.src, this.data.template, ObjectContentOrigins.SPAWNER, this.data.resolve).entity;
    const spawnOrigin = using6DOF && !this.data.animateFromCursor ? this.data.superHand : this.data.cursorSuperHand;

    spawnOrigin.object3D.getWorldPosition(entity.object3D.position);
    hand.object3D.getWorldQuaternion(entity.object3D.quaternion);
    entity.object3D.matrixNeedsUpdate = true;

    if (this.data.useCustomSpawnScale) {
      entity.object3D.scale.copy(this.data.spawnScale);
    }

    this.activateCooldown();

    await waitForEvent("body-loaded", entity);

    spawnOrigin.object3D.getWorldPosition(entity.object3D.position);
    hand.object3D.getWorldQuaternion(entity.object3D.quaternion);
    entity.object3D.matrixNeedsUpdate = true;

    if (hand !== this.data.cursorSuperHand && this.data.animateFromCursor) {
      hand.object3D.getWorldPosition(this.tempSpawnHandPosition);

      entity.setAttribute("animation__spawn-at-cursor", {
        property: "position",
        delay: 500,
        dur: 1500,
        from: { x: entity.object3D.position.x, y: entity.object3D.position.y, z: entity.object3D.position.z },
        to: { x: this.tempSpawnHandPosition.x, y: this.tempSpawnHandPosition.y, z: this.tempSpawnHandPosition.z },
        easing: "easeInOutBack"
      });
    }

    // Call syncToPhysics so that updated transforms aren't immediately overwritten
    entity.components["ammo-body"].syncToPhysics();

    if (!using6DOF) {
      for (let i = 0; i < this.data.grabEvents.length; i++) {
        hand.emit(this.data.grabEvents[i], { targetEntity: entity });
      }
    }
  },

  async onGrabStart(e) {
    if (this.cooldownTimeout) {
      return;
    }

    // This tells super-hands we are handling this grab. The user is now "grabbing" the spawner
    e.preventDefault();

    const hand = e.detail.hand;
    const thisGrabId = nextGrabId++;
    this.heldEntities.set(hand, thisGrabId);

    const entity = addMedia(
      this.data.src,
      this.data.template,
      ObjectContentOrigins.SPAWNER,
      this.data.resolve,
      this.data.resize
    ).entity;

    entity.object3D.position.copy(
      this.data.useCustomSpawnPosition ? this.data.spawnPosition : this.el.object3D.position
    );
    entity.object3D.rotation.copy(
      this.data.useCustomSpawnRotation ? this.data.spawnRotation : this.el.object3D.rotation
    );
    entity.object3D.scale.copy(this.data.useCustomSpawnScale ? this.data.spawnScale : this.el.object3D.scale);
    entity.object3D.matrixNeedsUpdate = true;

    await waitForEvent("body-loaded", entity);

    // If we are still holding the spawner with the hand that grabbed to create this entity, release the spawner and grab the entity
    if (this.heldEntities.get(hand) === thisGrabId) {
      if (this.data.centerSpawnedObject) {
        entity.body.position.copy(hand.object3D.position);
      }

      for (let i = 0; i < this.data.grabEvents.length; i++) {
        hand.emit(this.data.releaseEvents[i]);
        hand.emit(this.data.grabEvents[i], { targetEntity: entity });
      }
    }

    entity.object3D.scale.copy(this.data.useCustomSpawnScale ? this.data.spawnScale : this.el.object3D.scale);
    entity.object3D.matrixNeedsUpdate = true;

    // Call syncToPhysics so that updated transforms aren't immediately overwritten
    entity.components["ammo-body"].syncToPhysics();

    this.activateCooldown();
  },

  onGrabEnd(e) {
    this.heldEntities.delete(e.detail.hand);
    // This tells super-hands we are handling this release
    e.preventDefault();
  },

  activateCooldown() {
    if (this.data.spawnCooldown > 0) {
      this.el.setAttribute("visible", false);
      this.el.classList.remove("interactable");
      this.el.setAttribute("ammo-body", { collisionFlags: COLLISION_FLAGS.NO_CONTACT_RESPONSE });
      this.cooldownTimeout = setTimeout(() => {
        this.el.setAttribute("visible", true);
        this.el.classList.add("interactable");
        this.el.setAttribute("ammo-body", { collisionFlags: COLLISION_FLAGS.STATIC_OBJECT });
        this.cooldownTimeout = null;
      }, this.data.spawnCooldown * 1000);
    }
  }
});
