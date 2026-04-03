import {
  Injectable,
  NgModule,
  setClassMetadata,
  ɵɵdefineInjectable,
  ɵɵdefineInjector,
  ɵɵdefineNgModule
} from "./chunk-7PTTG7EG.js";
import {
  Subject,
  fromEvent,
  merge,
  timer
} from "./chunk-RSS3ODKE.js";
import "./chunk-46DXP6YY.js";

// node_modules/bn-ng-idle/fesm2020/bn-ng-idle.mjs
var BnNgIdleService = class {
  constructor() {
    this.expired$ = new Subject();
  }
  startWatching(timeOutSeconds) {
    this.idle$ = merge(fromEvent(document, "mousemove"), fromEvent(document, "click"), fromEvent(document, "mousedown"), fromEvent(document, "keypress"), fromEvent(document, "DOMMouseScroll"), fromEvent(document, "mousewheel"), fromEvent(document, "touchmove"), fromEvent(document, "MSPointerMove"), fromEvent(window, "mousemove"), fromEvent(window, "resize"));
    this.timeOutMilliSeconds = timeOutSeconds * 1e3;
    this.idleSubscription = this.idle$.subscribe((res) => {
      this.resetTimer();
    });
    this.startTimer();
    return this.expired$;
  }
  startTimer() {
    this.timer$ = timer(this.timeOutMilliSeconds, this.timeOutMilliSeconds).subscribe((res) => {
      this.expired$.next(true);
    });
  }
  resetTimer(timeOutSeconds) {
    this.timer$.unsubscribe();
    if (timeOutSeconds) {
      this.timeOutMilliSeconds = timeOutSeconds * 1e3;
    }
    this.startTimer();
  }
  stopTimer() {
    this.timer$.unsubscribe();
    this.idleSubscription.unsubscribe();
  }
};
BnNgIdleService.ɵfac = function BnNgIdleService_Factory(__ngFactoryType__) {
  return new (__ngFactoryType__ || BnNgIdleService)();
};
BnNgIdleService.ɵprov = ɵɵdefineInjectable({
  token: BnNgIdleService,
  factory: BnNgIdleService.ɵfac,
  providedIn: "root"
});
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(BnNgIdleService, [{
    type: Injectable,
    args: [{
      providedIn: "root"
    }]
  }], function() {
    return [];
  }, null);
})();
var BnNgIdleModule = class {
};
BnNgIdleModule.ɵfac = function BnNgIdleModule_Factory(__ngFactoryType__) {
  return new (__ngFactoryType__ || BnNgIdleModule)();
};
BnNgIdleModule.ɵmod = ɵɵdefineNgModule({
  type: BnNgIdleModule
});
BnNgIdleModule.ɵinj = ɵɵdefineInjector({
  providers: [BnNgIdleService],
  imports: [[]]
});
(() => {
  (typeof ngDevMode === "undefined" || ngDevMode) && setClassMetadata(BnNgIdleModule, [{
    type: NgModule,
    args: [{
      imports: [],
      declarations: [],
      providers: [BnNgIdleService],
      exports: []
    }]
  }], null, null);
})();
export {
  BnNgIdleModule,
  BnNgIdleService
};
//# sourceMappingURL=bn-ng-idle.js.map
