// INEO SAEIV (Tactileo) as a page: the whole device runs here - start-up and shut-down with the
// battery, service login (line, train), the main screen with the GPS, the delay scale, the
// departure count-down at the terminus, the end of service, the announcements and the alert.
// It is the behaviour of Script\TACTILEO\ineo_tactileo.osc, step for step; the comments name
// the macro each part comes from.
//
// Script\ineo_html\ineo_html.osc only does what a page cannot do: it keeps the texts the bus's
// other scripts read (passenger display, LumiTFT, destination sign), builds the announcement's
// file name, plays the sounds and hands the page the simulation's time.

window.omsi = window.omsi || {};

// The screen: the size of the old INEO pictures (Texture\INEO\*.tga), which are drawn as they
// are and cut into the pieces each screen is made of.
var W = 800;
var H = 480;
// (looked up in the page's folder, then the model's and the vehicle's: found in the vehicle's
// wherever the page is)
var TEX = "Texture/INEO/";

// Without a touch, the line/train input goes back to the welcome screen after this (s).
var NOTOUCH_S = 30;
// The ineo_constfile.txt values, when the script does not hand them over.
var DOOR_BACK = 1;
var DOOR_BLOCK_S = 10;

// ---------------------------------------------------------------------------------------------
// The device's state (the tactileo_* variables of the old script)
// ---------------------------------------------------------------------------------------------

var S = {
    mode: 0,
    power: 0,
    screenMode: 0,
    cockpitVisible: 0,
    inputButtonsVisible: 0,
    showDeparture: 0,
    showPrev: 0,
    showCurr: 0,
    showNext: 0,
    // the pictures of the screen's layers: the whole screen (screen mode 1), the whole screen,
    // the top right box and the right column (screen mode 2)
    seq1: "",
    seq2: "",
    seq3: "",
    seq4: "",

    initTimer: 0,
    extinctionTimer: 0,
    notouchTimer: 0,
    inputCheckTimer: 0,

    input: 0,
    inputCount: 0,
    inputText: "",
    inputData: "",
    ligne: 0,
    train: 0,
    ligneText: "",
    trainText: "",
    wmess: "",

    scheduleActive: 0,
    firstStopIndex: 0,
    lastStop: 0,
    atStation: 0,
    lastBusstopKnown: "",
    antiRepeatOff: 0,
    doorBlocked: 0,
    doorBlockedTimer: 0,
    doorPlayed: 0,

    delay: 0,
    delayText: "",
    startalertTimer: 0,
    blinker: 0,
    blinkTimer: 0,
    alert1: 0,
    alert2: 0,
    alert3: 0,

    stopInfo: "",
    stopHour: "",
    stopName: "",
    service: "",
    stateOfService: "",
    recap: "",
    currStop: "",
    nextStop: "",
    prevStop: "",
    // the main screen shows the line of the stops ("stops") or the GPS ("gps"): the globe
    // button changes it
    view: "stops",
};

// ---------------------------------------------------------------------------------------------
// What the bus tells the page
// ---------------------------------------------------------------------------------------------

function num(name) {
    var v = omsi.getVar(name);
    return typeof v === "number" ? v : 0;
}

function str(name) {
    var v = omsi.getVar(name);
    return typeof v === "string" ? v : "";
}

function route() {
    var v = omsi.vehicle;
    return v && v.route ? v.route : { stops: [], nextIndex: null, delaySec: 0, line: "" };
}

// The timetable, as the script's (M.V.GetTT...) gives it.
function scheduleActive() {
    var v = omsi.getVar("schedule_active");
    if (typeof v === "number") return v > 0.5 ? 1 : 0;
    return route().active ? 1 : 0;
}

function ttIndex() {
    var i = route().nextIndex;
    return typeof i === "number" ? i : 0;
}

function ttCount() {
    return (route().stops || []).length;
}

function ttStop(i) {
    var s = route().stops || [];
    return i >= 0 && i < s.length ? s[i] : null;
}

function ttName(i) {
    var s = ttStop(i);
    return s ? s.name : "";
}

function ttDelay() {
    return route().delaySec || 0;
}

// (L.S.Time): seconds since midnight.
function now() {
    var t = omsi.time;
    return t ? t.hour * 3600 + t.minute * 60 + t.second : 0;
}

function pad2(n) {
    return String(Math.floor(Math.abs(n))).padStart(2, "0");
}

// "HH:MM" of seconds after midnight, as the script writes it (no wrap after 24 h).
function hhmm(s) {
    var h = Math.trunc(s / 3600);
    return pad2(h) + ":" + pad2(Math.trunc((s / 3600 - h) * 60));
}

// The simulation's time step: the script counts it up (ineo_html_simtime, wrapping at 1000 s),
// so the timers stop in the pause and follow the time acceleration, as the old (L.S.Timegap).
var lastSim = null;
var lastStamp = null;

function timegap() {
    var t = omsi.getVar("ineo_html_simtime");
    var dt = 0;
    if (typeof t === "number") {
        if (lastSim !== null) {
            dt = t - lastSim;
            if (dt < 0) dt += 1000;
        }
        lastSim = t;
    } else {
        // (without the script: the page's clock, a second at a time)
        var s = omsi.timestamp || 0;
        if (lastStamp !== null) dt = s - lastStamp;
        lastStamp = s;
    }
    return Math.max(0, Math.min(dt, 1));
}

// ---------------------------------------------------------------------------------------------
// What the page tells the bus
// ---------------------------------------------------------------------------------------------

// The state the script and the bus's other scripts read (hanover, LumiTFT, Businfo).
var published = {};

function publish(name, value) {
    if (published[name] === value) return;
    published[name] = value;
    omsi.setVar(name, value);
}

function publishAll() {
    publish("tactileo_mode", S.mode);
    publish("tactileo_power", S.power);
    publish("tactileo_screen_mode", S.screenMode);
    publish("tactileo_cockpit_visible", S.cockpitVisible);
    publish("tactileo_input_buttons_visible", S.inputButtonsVisible);
    publish("tactileo_Show_Departure", S.showDeparture);
    publish("tactileo_Show_DisplayPrevStop", S.showPrev);
    publish("tactileo_Show_DisplayCurrStop", S.showCurr);
    publish("tactileo_Show_DisplayNextStop", S.showNext);
    publish("tactileo_schedule_active", S.scheduleActive);
    publish("tactileo_AtStation", S.atStation);
    publish("tactileo_FirstStopIndex", S.firstStopIndex);
    publish("tactileo_LastStopOnSchedule", S.lastStop);
    publish("tactileo_delay", S.delay);
    publish("tactileo_ligne", S.ligne);
    publish("tactileo_train", S.train);
}

function announceArrival() {
    omsi.trigger("ineo_html_announce_arrival");
}

function announceDoor() {
    omsi.trigger("ineo_html_announce_door");
}

function alertSound() {
    omsi.trigger("ineo_html_alert");
}

// ---------------------------------------------------------------------------------------------
// The touches (the old mouse events)
// ---------------------------------------------------------------------------------------------

function isStServan() {
    return num("ineo_html_depot_stservan") > 0.5;
}

// tactileo_num_input
function numInput(n) {
    S.notouchTimer = 0;
    var max = S.mode === 6 ? 4 : S.mode === 7 ? 2 : 0;
    if (S.inputCount < max) {
        S.input = S.input * 10 + n;
        S.inputText = S.inputText + String(n);
        S.inputCount++;
    }
}

function clearInput() {
    S.input = 0;
    S.inputCount = 0;
    S.inputText = "";
}

function press(key) {
    if (key.charAt(0) === "d") {
        numInput(parseInt(key.charAt(1)));
    } else if (key === "welcome") {
        // tactileo_welcome_validation
        if (S.mode === 5) {
            S.notouchTimer = 0;
            S.mode = 6;
        }
    } else if (key === "cancel") {
        // tactileo_login_cancel
        if (S.mode === 6) S.mode = 5;
        else if (S.mode === 7) S.mode = 6;
    } else if (key === "remove") {
        // tactileo_input_remove_one ("CORRECTION": the whole entry)
        if (S.mode === 6 || S.mode === 7) clearInput();
    } else if (key === "valid") {
        // tactileo_input_confirm
        S.notouchTimer = 0;
        if (S.mode === 6) {
            S.ligne = S.input;
            S.ligneText = S.inputText;
            clearInput();
            // St-Servan: the C lines
            if (isStServan() && (S.ligne === 20 || S.ligne === 23 || S.ligne === 24)) S.ligneText = "C" + S.ligneText;
            S.mode = 7;
        } else if (S.mode === 7) {
            S.train = S.input;
            S.trainText = pad2(S.train);
            clearInput();
            // St-Servan: line 24 runs as 24A (odd trains 1, 3, 5) and 24B. (The old script looked
            // at the train of the service before, as the train was not typed in yet.)
            if (isStServan() && S.ligne === 24) {
                S.ligneText = S.ligneText + (S.train === 1 || S.train === 3 || S.train === 5 ? "A" : "B");
            }
            S.mode = 8;
            S.inputCheckTimer = 0;
        }
    } else if (key === "globe") {
        // the main screen: the line of the stops or the GPS
        if (S.mode === 10) S.view = S.view === "gps" ? "stops" : "gps";
    } else if (key === "fs") {
        // tactileo_FS: end of service, asked
        if (S.mode === 10) {
            S.screenMode = 1;
            S.mode = 11;
        }
    } else if (key === "fsok") {
        // tactileo_confirm_FS
        if (S.mode === 11) {
            S.mode = 5;
            S.scheduleActive = 0;
            S.train = 0;
            S.ligne = 0;
            clearInput();
            S.trainText = "";
            S.ligneText = "";
        }
    } else if (key === "fsback") {
        // tactileo_cancel_FS
        if (S.mode === 11) {
            S.mode = 10;
            S.screenMode = 2;
        }
    }
    tick(0);
    render();
}

// ---------------------------------------------------------------------------------------------
// One step of the device (tactileo_frame, then tactileo_elec)
// ---------------------------------------------------------------------------------------------

// tactileo_UCE: is the bus at (or about to reach) its stop, and the texts of that stop.
function uce() {
    var sched = scheduleActive();
    var idx = ttIndex();
    var key = idx + "|" + ttName(idx);
    if (S.lastBusstopKnown !== key) {
        var stop = ttStop(idx);
        var arr = stop && typeof stop.arrivalSec === "number" ? stop.arrivalSec : null;
        if (arr !== null && arr > 86399) arr -= 86400;
        if (sched && arr !== null && arr + ttDelay() - now() < 15) {
            if (!S.antiRepeatOff) {
                announceArrival();
                S.antiRepeatOff = 1;
            }
            S.lastBusstopKnown = key;
            S.atStation = 1;
        } else {
            S.atStation = 0;
            S.antiRepeatOff = 0;
        }
    }
    if (S.scheduleActive && sched) S.firstStopIndex = idx;
    if (sched) {
        var count = ttCount();
        S.lastStop = count - 1;
        var first = ttStop(S.firstStopIndex);
        S.stopHour = first && typeof first.departureSec === "number" ? hhmm(first.departureSec) : "";
        S.stopName = ttName(S.firstStopIndex);
        // the stops beside the line of the stops view (at the first stop the next one is the
        // third: the St-Servan trips begin with their terminus twice)
        S.currStop = S.stopName;
        S.nextStop = ttName(S.firstStopIndex < 1 ? S.firstStopIndex + 2 : S.firstStopIndex + 1);
        S.prevStop = ttName(S.firstStopIndex - 1);
        S.service = S.ligneText + S.trainText;
        if (S.firstStopIndex < 1) S.stateOfService = "T.DEPART";
        else if (S.firstStopIndex === S.lastStop) S.stateOfService = "HLP@INTER-CRS";
        else S.stateOfService = "EN LIGNE";
    }
}

// tactileo_calc_delay: the delay in whole minutes, late (1) or early (2).
function calcDelay() {
    if (scheduleActive()) {
        var d = ttDelay();
        var m = d / 60;
        S.startalertTimer = m;
        if (Math.abs(d) >= 6) {
            if (m > -1) {
                S.delayText = pad2(Math.trunc(m));
                S.delay = 1;
            } else if (m < -1) {
                S.delayText = pad2(Math.trunc(m));
                S.delay = 2;
            }
        }
    } else {
        S.delayText = "";
        S.delay = 0;
    }
}

// The run's target: the script names it (tactileo_TEXT_RunTarget, with the depot's own short
// names), else the last stop of the trip.
function runTarget() {
    return str("tactileo_TEXT_RunTarget") || ttName(ttCount() - 1);
}

function frame(dt) {
    uce();
    calcDelay();
    var m = S.mode;
    if (m === 0) {
        S.screenMode = 1;
        S.showDeparture = 0;
        S.seq1 = "";
        S.cockpitVisible = 0;
        S.power = 0;
    }
    // "Initialisation", "Démarrage application", "UCE déconnecté", empty
    if (m >= 1 && m <= 4) {
        S.screenMode = 1;
        S.showDeparture = 0;
        S.seq1 = String(m);
        S.cockpitVisible = 0;
        S.inputButtonsVisible = 0;
        if (m === 1) S.power = 1;
    }
    // the welcome screen: the service to take
    if (m === 5) {
        S.screenMode = 1;
        S.showDeparture = 0;
        S.seq1 = "5";
        S.wmess = "Faire la prise de service@du vehicule " + str("number");
        S.cockpitVisible = 1;
        S.inputButtonsVisible = 0;
    }
    // the line, then the train; back to the welcome screen after 30 s without a touch
    if (m === 6 || m === 7) {
        S.screenMode = 1;
        S.showDeparture = 0;
        S.inputButtonsVisible = 1;
        S.seq1 = "6";
        S.inputData = m === 6 ? "LIGNE :" : "TRAIN :";
        S.notouchTimer += dt;
        if (S.notouchTimer > NOTOUCH_S) S.mode = 5;
    }
    // the service is checked: accepted with a timetable (to the main screen after 12 s), else
    // refused (back to the welcome screen after 4 s)
    if (m === 8) {
        S.screenMode = 1;
        S.showDeparture = 0;
        S.inputButtonsVisible = 0;
        S.seq1 = "6_2";
        var lt = S.ligneText + "/" + S.trainText;
        S.inputCheckTimer += dt;
        var t = S.inputCheckTimer;
        if (scheduleActive()) {
            if (t < 2) S.wmess = "Parametres en attente@de validation.";
            else if (t < 12) {
                S.firstStopIndex = ttIndex();
                S.wmess = "Ligne/Train : " + lt + "@Prise de service acceptee.";
                S.scheduleActive = 1;
            } else S.mode = 10;
        } else {
            clearInputNumber();
            S.scheduleActive = 0;
            if (t < 2) S.wmess = "Parametres en attente@de validation.";
            else if (t < 4) S.wmess = "Ligne/Train : " + lt + " invalide. @PRISE SCE REFUSEE";
            else S.mode = 5;
        }
    }
    if (m === 9) {
        S.showDeparture = 0;
        S.screenMode = 1;
        S.seq1 = "5";
        S.wmess = "Ligne/Train " + S.ligneText + "/" + S.trainText + "@Prise de service acceptee.";
    }
    // the main screen
    if (m === 10) {
        S.screenMode = 2;
        S.recap = S.ligneText + "@" + runTarget();
        var d = ttDelay();
        var dm = d / 60;
        var last = S.firstStopIndex === S.lastStop;
        if (!S.atStation) {
            S.showDeparture = 0;
            S.seq1 = S.seq2 = last ? "13" : "7";
            S.showPrev = 1;
            S.showCurr = 1;
            S.showNext = last ? 0 : 1;
        } else if (S.firstStopIndex === 0) {
            // at the terminus: the departure count-down
            S.showPrev = 0;
            S.showCurr = 1;
            S.showNext = 1;
            if (Math.abs(d) >= 6) {
                if (dm < -1) {
                    S.showDeparture = 2;
                    S.seq1 = S.seq2 = "11_2";
                } else if (dm > -1) {
                    S.seq1 = S.seq2 = "11_1";
                    S.showDeparture = 1;
                }
            }
        } else {
            S.showDeparture = 0;
            S.seq1 = S.seq2 = last ? "14" : "8";
            S.showPrev = 1;
            S.showCurr = 1;
            S.showNext = last ? 0 : 1;
        }
        // the top right box: late (RT) or early (AV)
        if (dm > -1) {
            S.seq3 = "11_1";
            S.blinker = 1;
        } else {
            S.blinker = 0;
            S.seq3 = "11_2";
            S.seq4 = "11_2";
        }
    } else {
        S.showDeparture = 0;
        S.showPrev = 0;
        S.showCurr = 0;
        S.showNext = 0;
    }
    // end of service: confirm or go back
    if (m === 11) {
        S.screenMode = 1;
        S.seq1 = "16";
    }
}

// (a refused service: the entry is dropped, the texts stay for the message)
function clearInputNumber() {
    S.input = 0;
    S.inputCount = 0;
}

// tactileo_strings: the service ends with the timetable; the announcement when the doors open.
function strings(dt) {
    if (scheduleActive()) S.stopInfo = "Arret de reference";
    if (S.mode === 10) {
        if (scheduleActive()) {
            if (num("door_0") && !S.antiRepeatOff) {
                announceDoor();
                S.antiRepeatOff = 1;
            }
        } else {
            S.antiRepeatOff = 0;
            S.showCurr = 0;
            S.showPrev = 0;
            S.showNext = 0;
            S.mode = 5;
        }
    }
    if (!num("AI")) {
        var back = typeof omsi.getVar("ineo_html_door_back") === "number" ? num("ineo_html_door_back") : DOOR_BACK;
        var open = num("door_0") > 0.9 || num("door_1") > 0.9;
        if (back) {
            for (var i = 2; i <= 7; i++) {
                if (num("door_" + i) > 0.9) open = true;
            }
        }
        if (open) {
            if (!S.doorBlocked && !S.doorPlayed) {
                announceDoor();
                S.doorBlocked = 1;
                S.doorPlayed = 1;
            }
        } else {
            S.doorPlayed = 0;
        }
    }
    if (S.doorBlocked) {
        var block = num("ineo_html_door_block_time") || DOOR_BLOCK_S;
        S.doorBlockedTimer = Math.min(S.doorBlockedTimer + dt, block);
        if (S.doorBlockedTimer === block) {
            S.doorBlocked = 0;
            S.doorBlockedTimer = 0;
        }
    }
}

// tactileo_delay_scale: the right column, the delay scale (or the departure bar at the terminus).
function delayScale() {
    if (S.mode !== 10) return;
    var first = S.atStation && S.firstStopIndex === 0;
    var d = ttDelay();
    var dm = d / 60;
    if (first && dm < -1) S.seq4 = "11_2";
    else if (first && dm > -1) S.seq4 = "11_1";
    else if (scheduleActive() && Math.abs(d) >= 6) {
        var t = Math.trunc(dm);
        if (dm < -1) S.seq4 = t < -18 ? "delay/AV18" : "delay/AV" + S.delayText;
        else S.seq4 = t > 19 ? "delay/RT19" : "delay/RT" + S.delayText;
    }
}

// tactileo_departure_BlinkerFunction: "DÉPART" blinks on the green bar once it is time to go.
function blinkerFunction(dt) {
    if (S.blinker !== 1 || !S.atStation || S.firstStopIndex !== 0) return;
    S.blinkTimer += dt;
    if (S.blinkTimer < 1) S.seq4 = "11_1";
    else if (S.blinkTimer < 2) S.seq4 = "11_3";
    else S.blinkTimer = 0;
}

// tactileo_startalert: three beeps before the departure, at 4, 1.5 and 1 minute.
function startAlert() {
    if (!num("elec_busbar_main")) return;
    if (S.showDeparture !== 1 && S.showDeparture !== 2) return;
    var steps = [
        ["alert1", -4],
        ["alert2", -1.5],
        ["alert3", -1],
    ];
    for (var i = 0; i < steps.length; i++) {
        var k = steps[i][0];
        if (S.startalertTimer > steps[i][1]) {
            if (!S[k]) {
                S[k] = 1;
                alertSound();
            }
        } else {
            S[k] = 0;
        }
    }
}

// The power: the start-up screens one after the other, and the shut-down when the battery goes.
function powerOk() {
    var v = omsi.getVar("ineo_html_power_ok");
    if (typeof v === "number") return v > 0.5;
    var e = omsi.vehicle && omsi.vehicle.electrics;
    return !!(e && e.busbarMain);
}

function elec(dt) {
    strings(dt);
    delayScale();
    blinkerFunction(dt);
    startAlert();
    if (powerOk()) {
        // (power back while the screen was going out: it starts again; the old script stayed on
        // its last screen)
        if (S.extinctionTimer > 0) {
            S.extinctionTimer = 0;
            S.initTimer = 0;
        }
        S.initTimer += dt;
        var t = S.initTimer;
        if (t < 5) S.mode = 0;
        else if (t < 10) {
            S.power = 1;
            S.screenMode = 1;
            S.mode = 1;
        } else if (t < 15) S.mode = 2;
        else if (t < 20) S.mode = 3;
        else if (t < 25) S.mode = 4;
        else if (t < 25.5) S.mode = 5;
    } else if (S.power) {
        // the battery is off: "UCE déconnecté", then dark
        S.extinctionTimer += dt;
        var e = S.extinctionTimer;
        if (e > 5 && e < 8) {
            S.mode = 3;
            S.inputButtonsVisible = 0;
        } else if (e < 10) {
            S.mode = 4;
        } else if (e < 15) {
            shutDown();
        }
    }
}

function shutDown() {
    S.power = 0;
    S.mode = 0;
    S.showDeparture = 0;
    S.screenMode = 0;
    S.initTimer = 0;
    S.extinctionTimer = 0;
    S.cockpitVisible = 0;
    S.ligne = 0;
    S.train = 0;
    S.ligneText = "";
    S.trainText = "";
    S.wmess = "";
    S.inputData = "";
    S.inputText = "";
    S.stopInfo = "";
    S.stopHour = "";
    S.stopName = "";
    S.service = "";
    S.stateOfService = "";
    S.recap = "";
    S.currStop = "";
    S.nextStop = "";
    S.prevStop = "";
    S.delayText = "";
    S.lastBusstopKnown = "";
    S.seq1 = "";
}

function tick(dt) {
    frame(dt);
    elec(dt);
    publishAll();
}

// ---------------------------------------------------------------------------------------------
// Drawing the screen
// ---------------------------------------------------------------------------------------------
//
// The engine has no positioning: the screen is cut into rows of cells along every edge of its
// layers and boxes (as the map of html/hello_tft.html is). A cell shows the layers that cover
// it, each a box over the one before with its piece of the picture (background-position).
// A box (a text, the GPS, a touch area) is drawn in the last of its cells - the one painted
// last - and pulled back over the others by negative margins; its right margin gives the room
// back, so boxes ending in the same cell all start from its corner.
//
// The engine keeps every element it ever made (an innerHTML with markup adds new ones and
// leaves the old ones behind, and getElementById finds the oldest): the cells are made again
// only when the screen's shape changes, with ids of their own each time, and everything else
// - the pictures, the texts, the map - changes the elements that are there.

// The texts, where the old text meshes were (pixels of the screen) and as they were drawn
// (the NEROSY Arial's 48 px glyphs scaled down to each mesh): font size, line height, the
// alignment (0 left, 1 centre) and how many letters fit. `bold: true` draws a text in bold,
// `color` gives it another colour than white.
var TEXTS = {
    time: { x: 711, y: 9, w: 80, h: 43, px: 32, lh: 32, align: 1, max: 5, bold: true },
    wmess: { x: 217, y: 129, w: 368, h: 136, px: 32, lh: 22, align: 1, max: 40 },
    inputData: { x: 19, y: 89, w: 120, h: 31, px: 32, lh: 27, align: 1, max: 9 },
    inputText: { x: 154, y: 87, w: 427, h: 61, px: 32, lh: 24, align: 0, max: 30, color: "#000000" },
    recap: { x: 20, y: 73, w: 199, h: 48, px: 24, lh: 23, align: 0, max: 21 },
    stopInfo: { x: 20, y: 242, w: 199, h: 20, px: 18, lh: 14, align: 0, max: 34, bold: true },
    stopHour: { x: 20, y: 269, w: 97, h: 31, px: 28, lh: 30, align: 0, max: 6, bold: true },
    stopName: { x: 20, y: 309, w: 199, h: 20, px: 24, lh: 19, align: 0, max: 25, bold: true },
    service: { x: 20, y: 344, w: 97, h: 31, px: 26, lh: 33, align: 0, max: 6, bold: true },
    stateOfService: { x: 123, y: 340, w: 96, h: 38, px: 11, lh: 14, align: 0, max: 14 },
    avret: { x: 618, y: 18, w: 46, h: 28, px: 22, lh: 27, align: 1, max: 3 },
    departure: { x: 630, y: 188, w: 54, h: 51, px: 32, lh: 38, align: 1, max: 3, bold: true },
    // the stops view: the next stop at the top of the line, the stop, the stop before
    nextStop: { x: 330, y: 70, w: 280, h: 20, px: 20, lh: 19, align: 0, max: 34, bold: true },
    currStop: { x: 330, y: 195, w: 280, h: 20, px: 20, lh: 19, align: 0, max: 34, bold: true },
    prevStop: { x: 330, y: 311, w: 280, h: 20, px: 20, lh: 19, align: 0, max: 34, bold: true },
};

// The touch areas, where the old click meshes were.
var ZONES = {
    welcome: { x: 194, y: 276, w: 414, h: 61 },
    cancel: { x: 33, y: 328, w: 199, h: 47 },
    d0: { x: 279, y: 329, w: 185, h: 47 },
    d1: { x: 279, y: 157, w: 59, h: 54 },
    d2: { x: 343, y: 157, w: 58, h: 54 },
    d3: { x: 405, y: 157, w: 59, h: 54 },
    d4: { x: 279, y: 214, w: 59, h: 54 },
    d5: { x: 343, y: 214, w: 58, h: 54 },
    d6: { x: 405, y: 214, w: 59, h: 54 },
    d7: { x: 279, y: 271, w: 59, h: 54 },
    d8: { x: 343, y: 271, w: 58, h: 54 },
    d9: { x: 405, y: 271, w: 59, h: 54 },
    valid: { x: 513, y: 329, w: 198, h: 47 },
    remove: { x: 586, y: 89, w: 126, h: 57 },
    fs: { x: 739, y: 70, w: 59, h: 317 },
    // the globe of the top bar: the line of the stops or the GPS
    globe: { x: 225, y: 6, w: 63, h: 44 },
    fsok: { x: 400, y: 277, w: 208, h: 61 },
    fsback: { x: 194, y: 277, w: 206, h: 61 },
};

// The GPS, where the stops of the trip were drawn.
var GPS = { x: 223, y: 67, w: 388, h: 316 };

// A layer: a picture's piece at the same place of the screen ("": black).
function layer(name, x, y, w, h) {
    return { src: name && name !== "0" ? TEX + name + ".tga" : "", x: x, y: y, w: w, h: h };
}

// The layers and boxes of the screen as it is now. `key` is its shape: it changes when a layer
// or a box comes or goes, not when a picture changes.
function screenParts() {
    var layers = [];
    var boxes = [];
    var keys = ["screen" + S.screenMode];
    if (S.screenMode === 2) {
        layers.push(layer(S.seq2, 0, 0, W, H));
        layers.push(layer(S.seq3, 584, 0, 216, 58));
        layers.push(layer(S.seq4 || "delay/RT00", 611, 58, 108, 330));
    } else if (S.screenMode === 1) {
        layers.push(layer(S.seq1, 0, 0, W, H));
    } else {
        layers.push(layer("", 0, 0, W, H));
    }

    var m = S.mode;
    var on = S.screenMode !== 0;
    if (on && S.cockpitVisible) addText(boxes, keys, "time");
    if (on && (m === 5 || m === 8 || m === 12)) addText(boxes, keys, "wmess");
    if (on && m === 5) addZone(boxes, keys, "welcome");
    if (on && S.inputButtonsVisible) {
        addText(boxes, keys, "inputData");
        addText(boxes, keys, "inputText");
        var keysPad = ["cancel", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "valid", "remove"];
        for (var k = 0; k < keysPad.length; k++) addZone(boxes, keys, keysPad[k]);
    }
    if (on && m === 10) {
        addText(boxes, keys, "recap");
        addText(boxes, keys, "stopInfo");
        addText(boxes, keys, "stopHour");
        addText(boxes, keys, "stopName");
        addText(boxes, keys, "service");
        addText(boxes, keys, "stateOfService");
        if (S.view === "gps") {
            boxes.push({ id: "gps", x: GPS.x, y: GPS.y, w: GPS.w, h: GPS.h, cls: "gps", style: "", text: false });
            keys.push("gps");
        } else {
            if (S.showNext) addText(boxes, keys, "nextStop");
            if (S.showCurr) addText(boxes, keys, "currStop");
            if (S.showPrev) addText(boxes, keys, "prevStop");
        }
        addZone(boxes, keys, "globe");
    }
    if (S.screenMode === 2) {
        addText(boxes, keys, "avret");
        addZone(boxes, keys, "fs");
    }
    if (on && S.showDeparture === 2) addText(boxes, keys, "departure");
    if (on && m === 11) {
        addZone(boxes, keys, "fsok");
        addZone(boxes, keys, "fsback");
    }
    return { layers: layers, boxes: boxes, key: keys.join("|") };
}

function addText(boxes, keys, id) {
    var t = TEXTS[id];
    boxes.push({ id: id, x: t.x, y: t.y, w: t.w, h: t.h, cls: "t", style: textStyle(t), text: true });
    keys.push(id);
}

function addZone(boxes, keys, id) {
    var z = ZONES[id];
    boxes.push({ id: id, x: z.x, y: z.y, w: z.w, h: z.h, cls: "z", click: id, style: "", text: false });
    keys.push(id);
}

function textStyle(t) {
    return (
        "font-size:" + t.px + "px;line-height:" + t.lh + "px;" +
        "text-align:" + (t.align === 1 ? "center" : "left") + ";" +
        "font-weight:" + (t.bold ? "bold" : "normal") + ";" +
        "color:" + (t.color || "#ffffff") + ";"
    );
}

// Sorted list of the distinct numbers in a (the engine's arrays have no sort).
function uniqueSorted(a) {
    var out = [];
    for (var i = 0; i < a.length; i++) {
        var k = 0;
        while (k < out.length && out[k] < a[i]) k++;
        if (k < out.length && out[k] === a[i]) continue;
        out.push(0);
        for (var m = out.length - 1; m > k; m--) out[m] = out[m - 1];
        out[k] = a[i];
    }
    return out;
}

function edges(rects, size, horizontal) {
    var a = [0, size];
    for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        var s = horizontal ? r.x : r.y;
        var e = s + (horizontal ? r.w : r.h);
        if (s > 0 && s < size) a.push(s);
        if (e > 0 && e < size) a.push(e);
    }
    return uniqueSorted(a);
}

function bgImage(src) {
    return "url(" + src + ")";
}

// The cells of the screen; what was made is noted in `made`: the cells of each layer (to give
// them another picture) and the elements of the boxes.
var gen = 0;
var made = { layers: [], srcs: [], boxes: {} };

function compose(parts) {
    gen++;
    var all = parts.layers.slice(0);
    for (var a = 0; a < parts.boxes.length; a++) all.push(parts.boxes[a]);
    var xs = edges(all, W, true);
    var ys = edges(all, H, false);
    // the boxes by the corner of their last cell
    var ending = {};
    for (var b = 0; b < parts.boxes.length; b++) {
        var bx = parts.boxes[b];
        var corner = bx.x + bx.w + "_" + (bx.y + bx.h);
        if (!ending[corner]) ending[corner] = [];
        ending[corner].push(bx);
    }
    var counts = [];
    for (var c = 0; c < parts.layers.length; c++) counts.push(0);
    var html = "";
    for (var j = 0; j + 1 < ys.length; j++) {
        var y0 = ys[j];
        var h = ys[j + 1] - y0;
        html += '<div class="row" style="height:' + h + 'px">';
        for (var i = 0; i + 1 < xs.length; i++) {
            var x0 = xs[i];
            var w = xs[i + 1] - x0;
            var open = "";
            var n = 0;
            for (var l = 0; l < parts.layers.length; l++) {
                var L = parts.layers[l];
                if (L.x > x0 || L.y > y0 || L.x + L.w < x0 + w || L.y + L.h < y0 + h) continue;
                open +=
                    '<span id="s' + gen + "_" + l + "_" + counts[l] + '" class="c" style="width:' + w + "px;height:" + h + "px;" +
                    "background-image:" + bgImage(L.src) + ";background-position:" + -x0 + "px " + -y0 + 'px">';
                counts[l]++;
                n++;
            }
            html += open;
            var here = ending[x0 + w + "_" + (y0 + h)];
            if (here) {
                for (var k = 0; k < here.length; k++) html += boxTag(here[k], x0, y0);
            }
            html += "</span>".repeat(n);
        }
        html += "</div>";
    }
    document.getElementById("screen").innerHTML = html;

    made = { layers: [], srcs: [], boxes: {} };
    for (var q = 0; q < parts.layers.length; q++) {
        var cells = [];
        for (var r = 0; r < counts[q]; r++) cells.push(document.getElementById("s" + gen + "_" + q + "_" + r));
        made.layers.push(cells);
        made.srcs.push(parts.layers[q].src);
    }
    for (var p = 0; p < parts.boxes.length; p++) {
        var box = parts.boxes[p];
        var id = "b" + gen + "_" + box.id;
        made.boxes[box.id] = {
            el: document.getElementById(id),
            l0: box.text ? document.getElementById(id + "_0") : null,
            l1: box.text ? document.getElementById(id + "_1") : null,
        };
    }
}

function boxTag(b, x0, y0) {
    var ml = b.x - x0;
    var mt = b.y - y0;
    var id = "b" + gen + "_" + b.id;
    return (
        '<span id="' + id + '" class="' + b.cls + '"' +
        (b.click ? " onclick=\"press('" + b.click + "')\"" : "") +
        ' style="width:' + b.w + "px;height:" + b.h + "px;" +
        "margin-left:" + ml + "px;margin-top:" + mt + "px;margin-right:" + (-ml - b.w) + "px;" +
        b.style + '">' +
        (b.text ? '<div id="' + id + '_0"></div><div id="' + id + '_1"></div>' : "") +
        "</span>"
    );
}

// A layer that shows another picture: its cells change their background.
function setPictures(parts) {
    for (var l = 0; l < parts.layers.length; l++) {
        var src = parts.layers[l].src;
        if (made.srcs[l] === src) continue;
        made.srcs[l] = src;
        var cells = made.layers[l] || [];
        for (var i = 0; i < cells.length; i++) {
            if (cells[i]) cells[i].style.backgroundImage = bgImage(src);
        }
    }
}

// The page has no overflow clipping, so long texts are cut by hand.
function cut(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

var shown = {};

// A text of the screen: '@' breaks it into lines (two at most here), and the lines are centred
// as a block, as the old text textures drew them.
function setText(id, value) {
    value = String(value || "");
    if (shown[id] === value) return;
    shown[id] = value;
    var b = made.boxes[id];
    if (!b || !b.el) return;
    var t = TEXTS[id];
    var lines = value.split("@");
    var second = lines.slice(1).join(" ");
    b.l0.textContent = cut(lines[0], t.max);
    b.l1.textContent = cut(second, t.max);
    var n = lines.length > 1 ? 2 : 1;
    b.el.style.paddingTop = Math.max(0, Math.floor((t.h - n * t.lh) / 2)) + "px";
}

function clock() {
    var t = omsi.time;
    return t ? pad2(t.hour) + ":" + pad2(t.minute) : "";
}

var layoutKey = "";

function render() {
    var parts = screenParts();
    if (parts.key !== layoutKey) {
        layoutKey = parts.key;
        compose(parts);
        shown = {};
        gpsKey = "";
        gpsEls = null;
    } else {
        setPictures(parts);
    }
    setText("time", clock());
    setText("wmess", S.wmess);
    setText("inputData", S.inputData);
    setText("inputText", S.inputText);
    setText("recap", S.recap);
    setText("stopInfo", S.stopInfo);
    setText("stopHour", S.stopHour);
    setText("stopName", S.stopName);
    setText("service", S.service);
    setText("stateOfService", S.stateOfService);
    setText("avret", S.delayText);
    setText("departure", S.delayText);
    setText("nextStop", S.nextStop);
    setText("currStop", S.currStop);
    setText("prevStop", S.prevStop);
    // (the GPS follows the bus 30 times a second, see GPS_MS; a new screen gets its map at once)
    if (made.boxes.gps && !gpsEls) drawGps();
}

// ---------------------------------------------------------------------------------------------
// The GPS (as the map of html/hello_tft.html, in the place of the trip's stops)
// ---------------------------------------------------------------------------------------------

// The maps come from ekrang's generated files, loaded by the page before this one:
//   ../../maps/maps.js     EKRANG_HOFS, EKRANG_MAPS (and EKRANG_STYLES, empty)
//   src/<map>/style.js     this screen's style of each map, added to EKRANG_STYLES
// The map shown is the one made for the depot the bus runs from (EKRANG_HOFS: the [name] of
// the .hof files, omsi.vehicle.info.yard), drawn in this screen's style of it. Its tiles
// t_<col>_<row>.png cover picture pixels [col*TILE, row*TILE] and onwards, and picture pixel
// (0, 0) is world point (X0, Y1), x east and y north, MPP metres a pixel. Without a map for the
// depot (or without this screen's style of it) the GPS stays empty.
// (the paths of the generated files are from the ekrang folder: this page is two folders down)
var ROOT = "../../";
var MAP = null;
var STYLE = null;
var MAP_DIR = "";
var X0 = 0;
var Y1 = 0;
var MPP = 1;
var TILE = 512;
var LEG_DIR = "";
var TRIPS = [];
var ROUTES = [];
var LEGS = [];
// The tiles there are ("<col>_<row>"): a missing one is the style's plain background.
var tileSet = {};
var BACKGROUND = "#ffd79c";
// The bus marker (the style's arrow, turned in steps of MARK_STEP degrees, in a square picture
// of MARK px) in the middle of the map.
var MARK_DIR = "";
var MARK = 0;
var MARK_STEP = 2;
// The map follows the bus 30 times a second (real time).
var GPS_MS = 33;

function norm(s) {
    return String(s || "")
        .trim()
        .toLowerCase();
}

// For each trip of the map, where each of its stops comes first in it (name -> index).
var tripStopIndex = [];

// The map of a depot and this screen's style of it: [map, style], or [null, null].
function mapFor(yard) {
    yard = norm(yard);
    var id = null;
    for (var i = 0; i < EKRANG_HOFS.length; i++) {
        if (norm(EKRANG_HOFS[i][0]) === yard) {
            id = EKRANG_HOFS[i][1];
            break;
        }
    }
    var map = null;
    var style = null;
    for (var m = 0; id !== null && m < EKRANG_MAPS.length; m++) {
        if (EKRANG_MAPS[m].id === id) map = EKRANG_MAPS[m];
    }
    for (var s = 0; map && s < EKRANG_STYLES.length; s++) {
        if (EKRANG_STYLES[s].map === id) style = EKRANG_STYLES[s];
    }
    // (a map without a style of this screen: its src/<map>/style.js is not in the page)
    return style ? [map, style] : [null, null];
}

// Takes the map of the bus's depot (when it is another than the one shown).
function chooseMap() {
    var v = omsi.vehicle;
    var found = mapFor(v && v.info ? v.info.yard : "");
    var m = found[0];
    // (by id: the engine may hand over a copy of the same map, which === would tell apart)
    if ((m ? m.id : null) === (MAP ? MAP.id : null)) return;
    MAP = m;
    STYLE = found[1];
    X0 = m ? m.X0 : 0;
    Y1 = m ? m.Y1 : 0;
    MPP = m ? m.MPP : 1;
    TILE = m ? m.TILE : 512;
    MAP_DIR = m ? ROOT + STYLE.dir + "tiles/" : "";
    LEG_DIR = m ? ROOT + STYLE.dir + "legs/" : "";
    TRIPS = m ? m.TRIPS : [];
    ROUTES = m ? m.ROUTES : [];
    LEGS = m ? STYLE.LEGS : [];
    tileSet = {};
    var tiles = m ? STYLE.TILES : [];
    for (var t = 0; t < tiles.length; t++) tileSet[tiles[t]] = true;
    BACKGROUND = m ? STYLE.background : "#ffd79c";
    MARK_DIR = m ? ROOT + STYLE.arrowDir : "";
    MARK = m ? STYLE.arrowSize || 0 : 0;
    MARK_STEP = m ? STYLE.arrowStep || 2 : 2;
    tripStopIndex = [];
    prepared = 0;
    lastMatchKey = null;
    lastMatch = -1;
    routeId = -1;
    tileLegs = {};
    // (the map's pieces are made again; without a map the GPS is left empty)
    gpsKey = "";
    gpsShown = "";
    if (!m && made.boxes.gps && gpsEls) {
        made.boxes.gps.el.innerHTML = "";
        gpsEls = null;
    }
}

// The trips' stops (tripStopIndex), PREPARE_TRIPS trips a call: a script may only run so long
// (the engine stops it after 400 000 steps), and a map has hundreds of trips. True once every
// trip is done.
var PREPARE_TRIPS = 20;
var prepared = 0;

function prepare() {
    var end = Math.min(TRIPS.length, prepared + PREPARE_TRIPS);
    for (var t = prepared; t < end; t++) {
        var at = {};
        var list = TRIPS[t][3];
        for (var u = 0; u < list.length; u++) {
            var key = norm(list[u]);
            if (at[key] === undefined) at[key] = u;
        }
        tripStopIndex.push(at);
    }
    if (end > prepared && end === TRIPS.length) lastMatchKey = null;
    prepared = end;
    return prepared === TRIPS.length;
}

// The route of the trip the bus is on: the trip that has the most of the bus's stops in the
// same order, the same line counting in its favour. At least two stops and half of them must
// agree. -1: none.
var lastMatchKey = null;
var lastMatch = -1;

function findRoute(r, line) {
    var names = (r.stops || []).map(function (s) {
        return norm(s.name);
    });
    line = norm(line);
    var matchKey = line + "#" + names.join("|");
    if (matchKey === lastMatchKey) return lastMatch;
    lastMatchKey = matchKey;
    lastMatch = -1;
    if (names.length < 2) return -1;
    var best = 0;
    for (var i = 0; i < TRIPS.length; i++) {
        var at = tripStopIndex[i];
        var matched = 0;
        var last = -1;
        for (var k = 0; k < names.length; k++) {
            var idx = at[names[k]];
            if (idx !== undefined && idx > last) {
                matched++;
                last = idx;
            }
        }
        if (matched < 2 || matched * 2 < names.length) continue;
        var score = matched * 10 + (line && norm(TRIPS[i][1]) === line ? 5 : 0) - Math.abs(TRIPS[i][3].length - names.length);
        if (score > best) {
            best = score;
            lastMatch = TRIPS[i][4];
        }
    }
    return lastMatch;
}

// The route shown, cut into legs: for each tile "<col>_<row>" the legs drawn on it, as
// [leg, index of its stop].
var routeId = -1;
var tileLegs = {};
// The index of the next stop: the legs to the stops before it are driven (grey).
var progress = -1;

function setRoute(id) {
    if (id === routeId) return;
    routeId = id;
    tileLegs = {};
    var list = id >= 0 ? ROUTES[id] : [];
    for (var i = 0; i < list.length; i++) {
        // (the style's tiles of this leg; none when the style is older than the map)
        var tiles = LEGS[list[i][0]] || [];
        for (var k = 0; k < tiles.length; k++) {
            if (!tileLegs[tiles[k]]) tileLegs[tiles[k]] = [];
            tileLegs[tiles[k]].push(list[i]);
        }
    }
}

function progressOf(r) {
    if (r.nextIndex !== null && r.nextIndex !== undefined) return r.nextIndex;
    if (!r.current) return -1;
    var name = norm(r.current.name);
    var stops = r.stops || [];
    for (var i = 0; i < stops.length; i++) {
        if (norm(stops[i].name) === name) return i;
    }
    return -1;
}

// The map window is smaller than a tile, so it shows at most four: it is cut into four
// quadrants at the tile edges (a quadrant may be empty), each showing its piece of one tile
// with the route's legs on that tile over it - the driven ones (grey) under those still ahead
// (blue). The marker is in the last quadrant (painted last), pulled back to the middle by
// negative margins. The elements are made again only when the tiles or the legs on them
// change; a move of the bus only changes their sizes and backgrounds.
var gpsKey = "";
var gpsGen = 0;
var gpsEls = null;
var gpsShown = "";

function quadrants(vx, vy) {
    var tx = Math.min(Math.ceil(vx / TILE) * TILE - vx, GPS.w);
    var ty = Math.min(Math.ceil(vy / TILE) * TILE - vy, GPS.h);
    var out = [];
    for (var q = 0; q < 4; q++) {
        var right = q % 2 === 1;
        var down = q >= 2;
        var x = right ? tx : 0;
        var y = down ? ty : 0;
        var w = right ? GPS.w - tx : tx;
        var h = down ? GPS.h - ty : ty;
        var col = Math.floor((vx + x) / TILE);
        var row = Math.floor((vy + y) / TILE);
        out.push({ x: x, y: y, w: w, h: h, col: col, row: row, legs: tileLegs[col + "_" + row] || [] });
    }
    return out;
}

function buildGps(qs) {
    gpsGen++;
    var g = "g" + gen + "_" + gpsGen;
    var html = "";
    for (var r = 0; r < 2; r++) {
        html += '<div id="' + g + "_r" + r + '" class="row">';
        for (var c = 0; c < 2; c++) {
            var q = r * 2 + c;
            html += '<span id="' + g + "_q" + q + '" class="cell">';
            for (var k = 0; k < qs[q].legs.length; k++) html += '<span id="' + g + "_q" + q + "_" + k + '" class="over">';
            if (q === 3 && MARK > 0) html += '<img id="' + g + '_m" width="' + MARK + '" height="' + MARK + '">';
            html += "</span>".repeat(qs[q].legs.length);
            html += "</span>";
        }
        html += "</div>";
    }
    made.boxes.gps.el.innerHTML = html;
    gpsEls = { rows: [], quads: [], legs: [], mark: document.getElementById(g + "_m") };
    for (var rr = 0; rr < 2; rr++) gpsEls.rows.push(document.getElementById(g + "_r" + rr));
    for (var qq = 0; qq < 4; qq++) {
        gpsEls.quads.push(document.getElementById(g + "_q" + qq));
        var legs = [];
        for (var kk = 0; kk < qs[qq].legs.length; kk++) legs.push(document.getElementById(g + "_q" + qq + "_" + kk));
        gpsEls.legs.push(legs);
    }
    gpsShown = "";
}

function drawMap(x, y, heading) {
    var bx = Math.round((x - X0) / MPP);
    var by = Math.round((Y1 - y) / MPP);
    var deg = Math.round(heading / MARK_STEP) * MARK_STEP;
    deg = ((deg % 360) + 360) % 360;
    var vx = bx - Math.round(GPS.w / 2);
    var vy = by - Math.round(GPS.h / 2);
    var qs = quadrants(vx, vy);

    var key = routeId + "#";
    for (var q = 0; q < 4; q++) key += qs[q].col + "_" + qs[q].row + ":" + qs[q].legs.length + ";";
    if (key !== gpsKey || !gpsEls) {
        gpsKey = key;
        buildGps(qs);
    }
    var state = bx + "," + by + "," + deg + "," + progress;
    if (state === gpsShown) return;
    gpsShown = state;

    gpsEls.rows[0].style.height = qs[0].h + "px";
    gpsEls.rows[1].style.height = qs[2].h + "px";
    for (var i = 0; i < 4; i++) {
        var Q = qs[i];
        var size = "width:" + Q.w + "px;height:" + Q.h + "px;";
        var pos = "background-position:" + (Q.col * TILE - (vx + Q.x)) + "px " + (Q.row * TILE - (vy + Q.y)) + "px;";
        // (a tile left out by the generator is plain background)
        var picture = tileSet[Q.col + "_" + Q.row] ? "background-image:url(" + MAP_DIR + "t_" + Q.col + "_" + Q.row + ".png)" : "";
        gpsEls.quads[i].setAttribute("style", size + pos + "background-color:" + BACKGROUND + ";" + picture);
        // the driven legs under those still ahead
        var order = [];
        for (var pass = 0; pass < 2; pass++) {
            for (var k = 0; k < Q.legs.length; k++) {
                var driven = progress >= 0 && Q.legs[k][1] < progress;
                if (driven === (pass === 0)) order.push([Q.legs[k][0], driven]);
            }
        }
        for (var n = 0; n < order.length; n++) {
            gpsEls.legs[i][n].setAttribute(
                "style",
                size + pos + "background-image:url(" + LEG_DIR + order[n][0] + "/" + (order[n][1] ? "g_" : "b_") + Q.col + "_" + Q.row + ".png)",
            );
        }
    }
    if (!gpsEls.mark) return;
    var mx0 = Math.round(GPS.w / 2 - MARK / 2);
    var my0 = Math.round(GPS.h / 2 - MARK / 2);
    gpsEls.mark.setAttribute("style", "margin-left:" + (mx0 - qs[3].x) + "px;margin-top:" + (my0 - qs[3].y) + "px");
    gpsEls.mark.setAttribute("src", MARK_DIR + "arrow_rotation_" + String(deg).padStart(3, "0") + ".png");
}

function drawGps() {
    if (!made.boxes.gps) return;
    chooseMap();
    if (!MAP) return;
    var v = omsi.vehicle;
    if (!v || !v.motion || v.motion.x === null || v.motion.y === null) return;
    var r = route();
    setRoute(prepare() ? findRoute(r, r.line || "") : -1);
    progress = routeId >= 0 ? progressOf(r) : -1;
    drawMap(v.motion.x, v.motion.y, v.motion.heading || 0);
}

// ---------------------------------------------------------------------------------------------

// The game calls update whenever a variable changes: the script's clock does every frame.
window.omsi.update = function (d) {
    tick(timegap());
    render();
};
render();
setInterval(drawGps, GPS_MS);
