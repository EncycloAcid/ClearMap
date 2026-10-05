// Clearway airport pack: Cleveland Hopkins International (CLE)
// Everything specific to one airport lives in its pack; the engine and UI work from whichever is active.
// Map data © OpenStreetMap contributors (ODbL); hours from shop-cle.com (Fraport USA).
AIRPORTS.CLE = (() => {
  // ---------- Walkway graph ----------
  // Coordinates are metres east (x) and south (y) of 41.4100 N, 81.8395 W, traced from
  // OpenStreetMap's indoor walkways, gates and building outlines. North is up.
  const GEO = { lat0: 41.4100, lon0: -81.8395, kx: Math.cos(41.41 * Math.PI / 180) * 111320, ky: 110574 };
  const V = {
    chk:  [112, -155, 'TSA security checkpoint'],
    hub:  [61, -121, 'Main terminal, past security'],
    fc:   [50, -70, 'Main terminal food court'],
    c0:   [40, -21, 'Concourse C'],
    c1:   [28, 34], c2: [-60, 124], c3: [-140, 206],
    c4:   [-163, 229, 'Concourse C rotunda'],
    crot: [-184, 266],
    b0:   [20, -129, 'Concourse B'], b1: [-36, -140], b2: [-186, -169],
    a0:   [78, -212, 'Concourse A'], a1: [98, -319], a2: [114, -410],
    tix:  [165, -200, 'Ticketing (upper level)'],
    bag:  [100, -70, 'Baggage claim (lower level)'],
    rta:  [111, -125, 'RTA Red Line to downtown'],
    gtc:  [172, -60, 'Ground Transportation Center'],
    taxi: [128, -12, 'Taxi stand'],
    rent: [182, -12, 'Rental car shuttle'],
    hotel:[184, 24, 'Hotel & parking shuttles'],
    ride: [178, -44, 'Rideshare pickup'],
    curb: [124, -44, 'Arrivals curb (Lower Drive)'],
    lift_t: [191, -202, 'Elevator by ticketing'],
    lift_c: [108, -130, 'Elevator beside the checkpoint'],
    lift_r: [110, -119, 'Elevator to the RTA platform'],
  };
  const EDGES = [
    ['chk','hub','S'], ['hub','fc','M'], ['fc','c0','M'], ['c0','c1','C'], ['c1','c2','C'], ['c2','c3','C'], ['c3','c4','C'], ['c4','crot','R'],
    ['hub','b0','M'], ['b0','b1','B'], ['b1','b2','B'], ['hub','a0','M'], ['a0','a1','A'], ['a1','a2','A'],
    ['tix','chk','L'], ['tix','bag','X','esc'], ['bag','rta','X','esc'], ['bag','gtc','L'], ['bag','taxi','L'], ['gtc','rent','L'], ['gtc','hotel','L'], ['gtc','ride','L'], ['bag','curb','L'],
    ['chk','bag','X','esc'],   // escalators beside the checkpoint between the upper and lower levels
    // elevators (step-free): ticketing ↔ baggage claim, checkpoint ↔ baggage claim, baggage claim ↔ RTA platform
    ['tix','lift_t','L'], ['lift_t','bag','X','lift'], ['chk','lift_c','L'], ['lift_c','bag','X','lift'],
    ['bag','lift_r','L'], ['lift_r','rta','X','lift'],
  ];
  const SPINES = { A: ['a0','a1','a2'], B: ['b0','b1','b2'], C: ['c0','c1','c2','c3','c4'] };
  const ROT = { x: -185, y: 268, r: 43 };
  const MAP_BOUNDS = { x0: -262, y0: -470, x1: 345, y1: 330 };
  
  
  // code: IATA designator; color/ink: the airline's brand colour for its mark
  const AIRLINES = [
    { name: 'Frontier', code: 'F9', color: '#0b6b4f', con: 'A', note: 'Domestic and international' },
    { name: 'Avelo', code: 'XP', color: '#5b2d8e', con: 'A' },
    { name: 'Delta', code: 'DL', color: '#c8102e', con: 'B' },
    { name: 'Southwest', code: 'WN', color: '#304cb2', con: 'B' },
    { name: 'United', code: 'UA', color: '#005daa', con: 'C' },
    { name: 'American', code: 'AA', color: '#0078d2', con: 'C' },
    { name: 'Air Canada Express', code: 'AC', color: '#d22630', con: 'C', note: 'Toronto; Montréal in summer', ops: ['Jazz'], aka: ['Air Canada'] },
    { name: 'Aer Lingus', code: 'EI', color: '#00806e', con: 'C', note: 'Dublin' },
    { name: 'Alaska', code: 'AS', color: '#01426a', con: 'C' },
    { name: 'JetBlue', code: 'B6', color: '#0033a0', con: 'C' },
    // Regional brands: smaller jets flown for the big airlines by partner airlines, whose names are
    // often what the boarding pass shows ("operated by SkyWest dba United Express"). Same gates and
    // check-in counters as the airline they fly for.
    { name: 'United Express', code: 'UA', color: '#005daa', con: 'C', partner: 'United', ops: ['SkyWest', 'Republic', 'CommuteAir', 'GoJet'] },
    { name: 'American Eagle', code: 'AA', color: '#0078d2', con: 'C', partner: 'American', ops: ['Envoy', 'Piedmont', 'PSA Airlines', 'Republic', 'SkyWest'] },
    { name: 'Delta Connection', code: 'DL', color: '#c8102e', con: 'B', partner: 'Delta', ops: ['Endeavor Air', 'SkyWest', 'Republic'] },
    { name: 'Charter flights', code: '', color: '#5b6474', con: 'A', note: 'Sports teams, tour and casino charters' },
  ];
  const CON_RANGE = { A: 'A1–A14', B: 'B1–B11', C: 'C2–C29' };
  // concourses: id, colour [light, dark], badge shape [lobes, depth]
  const concourses = [
    { id: 'A', color: ['#64798a', '#93a6b4'], shape: [0, 0] },
    { id: 'B', color: ['#2563d8', '#5f97f2'], shape: [4, .16] },
    { id: 'C', color: ['#7a4cd6', '#a989ee'], shape: [9, .075] },
  ];
  
  // Gate positions (metres) from OpenStreetMap; the official directory's gate list.
  const GATE_POS = {
    A1: [65, -247], A2: [95, -261], A3: [75, -296], A5: [91, -354], A6: [115, -315], A7: [81, -399], A8: [128, -383],
    A9: [84, -412], A10: [128, -402], A11: [90, -424], A12: [132, -421], A14: [116, -427],
    B1: [-40, -128], B2: [-34, -153], B3: [-100, -139], B4: [-80, -162], B5: [-132, -145], B6: [-139, -173], B7: [-168, -152],
    B8: [-193, -185], B9: [-198, -157], B10: [-195, -181], B11: [-199, -162],
    C2: [27, -13], C3: [4, 45], C4: [3, 76], C5: [-34, 84], C6: [-31, 110], C7: [-65, 115], C8: [-65, 145], C9: [-86, 137],
    C10: [-99, 179], C11: [-118, 170], C14: [-148, 200],
    C17: [-201, 235], C18: [-215, 249], C19: [-229, 270], C20: [-240, 277], C21: [-229, 296], C22: [-228, 297], C23: [-202, 309],
    C24: [-186, 311], C25: [-170, 307], C26: [-151, 294], C27: [-142, 280], C29: [-138, 247],
  };
  const ROT_GATES = (['C17','C18','C19','C20','C21','C22','C23','C24','C25','C26','C27','C29']);
  
  // Amenities from the airport's directory: [name, category, nearest gate or [x,y,zone], dwell?, note?]
  const AMEN = [
    ['800 Degrees Wood Fired Kitchen','food','A1'], ["Sammy's Beach Bar & Grill",'bar',[88,-242,'A','A1']], ['Starbucks','coffee',[87,-235,'A','A1']],
    ['Hudson','shop',[86,-218,'A','A1']], ['Ohio Lottery','play','A1',5], ['Restrooms','rest',[62,-206,'A','A1']], ['Restrooms','rest',[91,-256,'A','A2']], ['FuelRod phone charging','service','A1',5],
    ['First Class Seats massage chairs','play','A2',15], ['Illy Coffee vending','coffee','A5',4], ['Hudson','shop','A5'],
    ['Shop All Pharmacy vending','service','A5',4], ["Panini's Bar & Grill",'bar','A6'], ['Ohio Lottery','play','A6',5],
    ['Restrooms','rest',[116,-341,'A','A6']], ["Farmer's Fridge vending",'food','A8',4],
    ["Mother's Room",'service','B1',20], ["Farmer's Fridge vending",'food','B1',4], ['The Club CLE lounge','play','B1',45,'Day passes sold at the door'],
    ['Vino Volo','bar','B2'], ['Restrooms','rest',[-48,-151,'B','B2']], ['FuelRod phone charging','service','B2',5], ['Ohio Lottery','play','B3',5],
    ['Hudson News Euro Café','coffee','B4'], ['Inca Tea Café','coffee','B4'], ['Hudson','shop',[-71,-155,'B','B4']], ['Cleveland Shines shoe shine','service','B4',15],
    ['Quaker Steak & Lube','bar',[-121,-146,'B','B5']], ["Auntie Anne's",'coffee',[-125,-163,'B','B6'],6], ['Cinnabon','coffee','B6',6], ["Menchie's Frozen Yogurt",'coffee','B6'],
    ['Subway','food','B6',12], ['FuelRod phone charging','service','B7',5], ['Restrooms','rest','B8'],
    ['InMotion electronics','shop',[34,27,'C','C2']], ['TUMI','shop','C2'], ['La Boutique','shop','C2'], ['Jamba','coffee','C2',6],
    ['Aircuts & Day Spa','service','C2',30], ['Cleveland Shines shoe shine','service','C2',15], ['Hudson','shop',[24,24,'C','C2']], ['Restrooms','rest',[16,36,'C','C3']],
    ['LEGO vending','play','C3',5], ["Farmer's Fridge vending",'food','C3',4], ['FuelRod phone charging','service','C3',5],
    ['First Class Seats massage chairs','play','C4',15], ['Bar Symon','bar','C6'], ['Ohio Lottery','play','C6',5],
    ['Petit Gourmet','food','C7',15], ['Restrooms','rest',[-87,163,'C','C10']], ['Hudson','shop','C8'], ['Destination Cleveland vending','play','C9',5,'Local souvenirs'],
    ['Inca Tea Café','coffee','C10'], ['First Class Seats massage chairs','play','C10',15], ['Caramel & Licorice & Taffy vending','coffee','C11',4],
    ['Great Lakes Brewing Co.','bar',[-122,197,'C','C11'],30,"Cleveland's craft brewery"], ['Shop All Pharmacy vending','service','C14',4], ['FuelRod phone charging','service','C14',5],
    ["Farmer's Fridge vending",'food','C17',4], ['First Class Seats massage chairs','play','C17',15], ['Restrooms','rest',[-196,265,'R','C20']],
    ['Starbucks','coffee',[-205,279,'R','C20']], ['Cantina Taqueria & Tequila Bar','bar','C24'], ['Hudson','shop',[-169,276,'R','C26']], ['Ohio Lottery','play','C27',5],
    ['Potbelly Sandwich Shop','food',[-163,252,'R','C29'],15],
    ["Bruegger's Bagels",'food',[55,-47,'M'],12], ['Shake Shack','food',[66,-58,'M']], ['Chick-fil-A','food',[59,-67,'M'],15],
    ['Currito Burritos','food',[62,-78,'M'],15], ["Dunkin' (open 24 hrs)",'coffee',[44,-80,'M']], ['The Pub','bar',[66,-94,'M']],
    ['Embers Fire & Ice Bar','bar',[74,-110,'M']], ["Auntie Anne's",'coffee',[34,-37,'M'],6], ['Cinnabon','coffee',[32,-26,'M'],6],
    ['Sunglass Hut','shop',[38,-113,'M']], ['Johnston & Murphy','shop',[44,-124,'M']], ['Hudson Booksellers','shop',[50,-139,'M'],15],
    ['Rock & Roll Hall of Fame store','play',[53,-108,'M'],15,'Cleveland music souvenirs'], ['Ohio Game Day Sports','shop',[80,-128,'M']],
    ['Kids Works','play',[84,-140,'M'],15,'Toys and games'], ['Service animal relief area','service',[92,-152,'M'],10], ['Restrooms','rest',[76,-138,'M']],
    ['Restrooms','rest',[-160,-173,'B','B6']], ['Accessible restroom','rest',[-156,-169,'B','B6'],5,'Wheelchair accessible'], ['Restrooms','rest',[37,-48,'M']], ['Accessible restroom','rest',[41,-44,'M'],5,'Wheelchair accessible'],
    ['Accessible restroom','rest',[-192,269,'R','C20'],5,'Wheelchair accessible'],
    ['Water fountain','service',[25,12,'C','C2'],3], ['Water fountain','service',[12,41,'C','C3'],3], ['Water fountain','service',[-15,68,'C','C5'],3],
    ['Water fountain','service',[-129,186,'C','C11'],3],
    ['Elevator','service',[191,-202,'LIFT','lift_t'],2,'Ticketing ↔ baggage claim'], ['Elevator','service',[108,-130,'LIFT','lift_c'],2,'Checkpoint ↔ baggage claim'],
    ['Elevator','service',[110,-119,'LIFT','lift_r'],2,'Baggage claim ↔ RTA platform'],
    ['Information desk','service',[152,-190,'L'],5], ["Farmer's Fridge vending",'food',[170,-208,'L'],4], ['Illy Coffee vending','coffee',[160,-210,'L'],4],
    ['Welcome Center','service',[108,-58,'L'],5], ['Hudson Aero Mart','shop',[104,-84,'L']], ['SIM card vending','service',[110,-96,'L'],5],
  ];
  
  // Opening hours from the airport's official directory (shop-cle.com, Fraport USA), checked Oct 2026.
  // The directory gives opening times only; closing times aren't published (they follow the last flights).
  const H = (open, more = {}) => ({ open, ...more });
  const H24 = { h24: true };
  const HOURS = {
    '800 Degrees Wood Fired Kitchen': H('4:00'), "Auntie Anne's": it => H(it.gate === 'B6' ? '4:30' : '4:00'),
    'Bar Symon': H('4:00'), "Bruegger's Bagels": H('4:00'), 'Cantina Taqueria & Tequila Bar': H('4:30'),
    'Chick-fil-A': H('4:00', { days: [1, 2, 3, 4, 5, 6] }), 'Cinnabon': it => H(it.gate === 'B6' ? '4:30' : '4:00'),
    'Currito Burritos': H('5:00'), "Dunkin' (open 24 hrs)": H24, 'Embers Fire & Ice Bar': H('5:30'),
    "Farmer's Fridge vending": H24, 'Great Lakes Brewing Co.': H('4:00'), 'Hudson News Euro Café': H('4:00'),
    'Inca Tea Café': H('4:00'), 'Jamba': H('4:00'), "Panini's Bar & Grill": H('4:00'), 'Potbelly Sandwich Shop': H('4:30'),
    'The Pub': H('4:00'), 'Quaker Steak & Lube': H('4:00'), "Sammy's Beach Bar & Grill": H('4:00'), 'Shake Shack': H('4:00'),
    'Starbucks': H('4:00'), 'Subway': H('4:00'), 'Vino Volo': { vary: true }, 'Destination Cleveland vending': H24,
    'Hudson Booksellers': H('4:00'), 'Illy Coffee vending': H24, 'InMotion electronics': H('5:00'), 'Johnston & Murphy': H('5:00'),
    'Kids Works': H('5:00'), 'La Boutique': H('5:00'), 'LEGO vending': H24, 'Caramel & Licorice & Taffy vending': H24,
    'Ohio Game Day Sports': H('5:00'), 'Rock & Roll Hall of Fame store': H('5:00'), 'Shop All Pharmacy vending': H24,
    'Sunglass Hut': H('5:00'), 'TUMI': H('5:00'), 'Hudson': it => H(it.gate === 'C26' ? '4:30' : '4:00'),
    'Hudson Aero Mart': H('8:00'), 'Cleveland Shines shoe shine': H('6:00', { close: '18:00', days: [1, 2, 3, 4, 5] }),
    'First Class Seats massage chairs': H24, 'FuelRod phone charging': H24, 'Ohio Lottery': H24, 'SIM card vending': H24,
    'The Club CLE lounge': H('4:00'), 'Petit Gourmet': H('4:00'),
  };

  return {
    code: 'CLE', name: 'Cleveland Hopkins International', short: 'Cleveland Hopkins', city: 'Cleveland', tz: 'America/New_York',
    GEO, V, EDGES, SPINES, ROT, MAP_BOUNDS, AIRLINES, CON_RANGE, GATE_POS, ROT_GATES, AMEN, HOURS,
    concourses,
    // the lower-level shops and services are in the main terminal south of the checkpoint
    amenLevel: it => it.zone === 'L' && it.y > -150 ? 'lo' : 'up',
    LOWER_V: ['bag', 'rta', 'gtc', 'taxi', 'rent', 'hotel', 'ride', 'curb', 'lift_r'],
    PLACES: ['chk', 'tix', 'bag', 'rta', 'gtc', 'taxi', 'rent', 'hotel', 'ride', 'curb'],
    // how each place is drawn: [icon, kind]; kinds set the sign colour (terminal, bags, transit, ground)
    PLACE_STYLE: { chk: ['shield', 'terminal'], tix: ['ticket', 'terminal'], bag: ['bag', 'bags'], rta: ['train', 'transit'],
      gtc: ['bus', 'ground'], taxi: ['taxi', 'ground'], rent: ['key', 'ground'], hotel: ['bed', 'ground'], ride: ['phone', 'ground'], curb: ['car', 'ground'] },
    basemap: BASEMAP_CLE,
    // node roles the engine needs: security checkpoint, airside hub, baggage claim, ticketing
    roles: { checkpoint: 'chk', hub: 'hub', baggage: 'bag', ticketing: 'tix', transit: 'rta' },
    ui: {
      // [x, y, text, anchor, floor]; no floor means both
      labels: [[150, -95, 'Main terminal', , 'up'], [62, -100, 'Baggage claim', , 'lo'], [-185, 271, 'Rotunda'], [255, -40, 'Parking garage'], [125, 385, 'Concourse D · closed'], [140, 60, 'Lower Drive']],
      roundels: [['A', 118, -458], ['B', -236, -171], ['C', 72, 28]],
      securityLine: [100, -167, 124, -143],
      closedTerms: ['termD'],
      airlinesNote: 'All three concourses connect past security, so you can walk between them.',
      airlinesTip: 'International arrivals clear U.S. Customs near gate A5. Concourse D has been closed since 2014.',
      defaults: { from: 'v:chk', to: 'g:C22', gate: 'g:C22', arrGate: 'g:B6' },
      popular: ['v:chk', 'v:bag', 'v:rta'], popularRe: /Great Lakes|Bar Symon|Rock & Roll/,
      floors: { up: 'Upper level · gates, security, ticketing', lo: 'Lower level · baggage claim, ground transportation, RTA' },
      // arrivals destinations: [place id, label, tip]
      arrivals: [
        ['v:rta', 'RTA Red Line to downtown', 'Red Line trains run to downtown (Tower City) in about 25 minutes. Buy a fare at the machines before you board.'],
        ['v:ride', 'Rideshare (Uber, Lyft)', 'Follow the Ground Transportation signs. Your app shows the exact pickup spot, so request once you have your bags.'],
        ['v:taxi', 'Taxi', 'Taxis wait at the stand on Lower Drive.'],
        ['v:curb', 'Someone picking me up', 'Arrivals pickup is on Lower Drive. Drivers can wait in the free cell phone lot until you’re outside.'],
        ['v:rent', 'Rental car shuttle', 'Shuttles run to the off-airport Rental Car Center.'],
        ['v:hotel', 'Hotel or parking shuttle', 'Hotel and off-airport parking shuttles stop by the Ground Transportation Center.'],
        ['v:bag', 'Meeting someone at baggage claim', 'Baggage claim is on the lower level, past the escalators.'],
      ],
      // extra notes for particular route steps at this airport
      stepNote(n, path, i) {
        if (n === 'c4') return 'Gates C17–C29 ring the rotunda';
        if (n === 'fc' && path.includes('c0')) return 'Follow the purple C signs';
        if (n === 'lift_r') return path[i + 1] === 'rta' ? 'Take the elevator down to the RTA platform' : 'Take the elevator up to baggage claim';
        return '';
      },
    },
  };
})();
