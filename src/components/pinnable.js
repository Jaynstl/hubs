AFRAME.registerComponent("pinnable", {
  schema: {
    pinned: { default: false }
  },

  init() {
    this._applyState = this._applyState.bind(this);
    this._fireEvents = this._fireEvents.bind(this);
    this._allowApplyOnceComponentsReady = this._allowApplyOnceComponentsReady.bind(this);
    this._allowApply = false;

    this.el.sceneEl.addEventListener("stateadded", this._applyState);
    this.el.sceneEl.addEventListener("stateremoved", this._applyState);

    // Fire pinned events when we drag and drop or scale in freeze mode,
    // so transform gets updated.
    this.el.addEventListener("grab-end", this._fireEvents);

    // Fire pinned events when page changes so we can persist the page.
    this.el.addEventListener("pager-page-changed", this._fireEvents);

    // Fire pinned events when video state changes so we can persist the page.
    this.el.addEventListener("owned-video-state-changed", this._fireEvents);

    // Hack: need to wait for the initial grabbable and stretchable components
    // to show up from the template before applying.
    this.el.addEventListener("componentinitialized", this._allowApplyOnceComponentsReady);
    this._allowApplyOnceComponentsReady();
  },

  remove() {
    this.el.sceneEl.removeEventListener("stateadded", this._applyState);
    this.el.sceneEl.removeEventListener("stateremoved", this._applyState);
    this.el.removeEventListener("componentinitialized", this._allowApplyOnceComponentsReady);
  },

  update(oldData) {
    this._applyState();
    this._fireEvents(oldData);
  },

  _fireEvents(oldData) {
    // super-networked-interactable fires grab-end when a remote user takes ownership of an entity, so we need to
    // ignore that case here. We also need to guard against _fireEvents being called during entity initialization,
    // when the networked component isn't initialized yet.
    if (this.el.components.networked && this.el.components.networked.data && !NAF.utils.isMine(this.el)) return;

    const pinStateChanged = !!oldData.pinned !== this.data.pinned;

    if (this.data.pinned) {
      this.el.emit("pinned", { el: this.el, changed: pinStateChanged });

      this.el.removeAttribute("animation__pin-start");
      this.el.removeAttribute("animation__pin-end");
      const currentScale = this.el.object3D.scale;

      this.el.setAttribute("animation__pin-start", {
        property: "scale",
        dur: 200,
        from: { x: currentScale.x, y: currentScale.y, z: currentScale.z },
        to: { x: currentScale.x * 1.1, y: currentScale.y * 1.1, z: currentScale.z * 1.1 },
        easing: "easeOutElastic"
      });

      this.el.setAttribute("animation__pin-end", {
        property: "scale",
        delay: 200,
        dur: 200,
        from: { x: currentScale.x * 1.1, y: currentScale.y * 1.1, z: currentScale.z * 1.1 },
        to: { x: currentScale.x, y: currentScale.y, z: currentScale.z },
        easing: "easeOutElastic"
      });
    } else {
      this.el.emit("unpinned", { el: this.el, changed: pinStateChanged });
    }
  },

  _allowApplyOnceComponentsReady() {
    if (!this._allowApply && this.el.components.grabbable && this.el.components.stretchable) {
      this._allowApply = true;
      this._applyState();
    }
  },

  _applyState() {
    if (!this._allowApply) return;
    const isFrozen = this.el.sceneEl.is("frozen");

    if (this.data.pinned && !isFrozen) {
      if (this.el.components.stretchable) {
        this.el.removeAttribute("stretchable");
      }

      this.el.setAttribute("ammo-body", { type: "static" });

      if (this.el.components.grabbable.data.maxGrabbers !== 0) {
        this.prevMaxGrabbers = this.el.components.grabbable.data.maxGrabbers;
      }

      this.el.setAttribute("grabbable", { maxGrabbers: 0 });
    } else {
      this.el.setAttribute("grabbable", { maxGrabbers: this.prevMaxGrabbers });

      if (!this.el.components.stretchable) {
        this.el.setAttribute("stretchable", { useWorldPosition: true, usePhysics: "never" });
      }
    }
  }
});
