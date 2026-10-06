// Clearway airport pack: Cleveland Hopkins International (CLE)
// Everything specific to one airport lives in its pack; the engine and UI work from whichever is active.
// Map data © OpenStreetMap contributors (ODbL); hours from shop-cle.com (Fraport USA).
AIRPORTS.CLE = (() => {
  // ---------- Walkway graph ----------
  // Coordinates are metres east (x) and south (y) of 41.4100 N, 81.8395 W, traced from
  // OpenStreetMap's indoor walkways, gates and building outlines. North is up.
  const GEO = { lat0: 41.4100, lon0: -81.8395, kx: Math.cos(41.41 * Math.PI / 180) * 111320, ky: 110574 };
  const V = {
    // Three TSA checkpoints on the departures level, all leading to every concourse. Positions follow
    // OpenStreetMap's corridors from the ticketing hall to the gates (the checkpoints aren't mapped there).
    chk:  [104, -150, 'TSA Central checkpoint'],
    chk_n: [120, -205, 'TSA North checkpoint'],
    chk_s: [63, -53, 'TSA South checkpoint'],
    sj:   [46, -50],
    // The ticketing hall (upper level) and baggage claim (lower level) are one long hall on two floors
    // along the curb, each with a walkway end to end (OpenStreetMap's indoor footways), escalators and
    // elevators at the north end, the middle and the south end.
    th0: [171, -212], th1: [155, -198], th2: [115, -159], th4: [86, -100], tix_s: [76, -54],
    th3: [94, -133, 'Central escalators (upper level)'], th6: [70, -25, 'South escalators (upper level)'],
    bg0: [183, -203], bg1: [158, -180], bg2: [122, -145], bg5: [94, -69], bg7: [82, -6],
    bg3: [106, -121, 'Central escalators (lower level)'], bag_s: [87, -30, 'South escalators (lower level)'],
    // past the Central checkpoint the corridor turns west to the main terminal (OpenStreetMap)
    cw:   [90, -117],
    hub:  [61, -121, 'Main terminal, past security'],
    fc:   [50, -70, 'Main terminal food court'],
    c0:   [40, -21, 'Concourse C'],
    c1:   [28, 34], c2: [-60, 124], c3: [-140, 206],
    c4:   [-163, 229, 'Concourse C rotunda'],
    // the rotunda's walkway: a ring round the central shops, from c4 and back (OpenStreetMap's indoor footway);
    // the gates are off its outer side
    r0: [-178, 243], r1: [-192, 238], r2: [-204, 242], r3: [-211, 253], r4: [-211, 263], r5: [-207, 272], r6: [-209, 292], r7: [-199, 296], r8: [-187, 296], r9: [-175, 293], r10: [-165, 287], r11: [-156, 273], r12: [-153, 260], r13: [-153, 250], r14: [-156, 241],
    b0:   [20, -129, 'Concourse B'], b1: [-36, -140], b2: [-186, -169],
    a0:   [78, -212, 'Concourse A'], a1: [98, -319], a2: [114, -410],
    tix:  [146, -190, 'Ticketing (upper level)'],
    bag:  [100, -95, 'Baggage claim (lower level)'],
    rta:  [111, -125, 'RTA Red Line to downtown'],
    // ground transportation: the Ground Transportation Center is at the north end of the baggage claim
    // level (the airport's map; rental car and hotel shuttles leave from its curb); rideshare and taxis pick
    // up at the curb outside baggage claim
    gtc:  [196, -222, 'Ground Transportation Center'],
    taxi: [128, -12, 'Taxi stand'],
    rent: [214, -221, 'Rental car shuttle'],
    hotel:[210, -237, 'Hotel & parking shuttles'],
    ride: [137, -99, 'Rideshare pickup'],
    curb: [124, -44, 'Arrivals curb (Lower Drive)'],
    lift_t: [191, -202, 'Elevator by ticketing'],
    lift_c: [108, -130, 'Elevator beside the checkpoint'],
    lift_r: [110, -119, 'Elevator to the RTA platform'],
    lift_s: [77, -23, 'Elevator by the south escalators'],
  };
  const EDGES = [
    ['chk','cw','S'], ['cw','hub','M'], ['hub','fc','M'], ['fc','sj','M'], ['sj','c0','M'],
    // ticketing hall, north to south, and the three checkpoints off it
    ['th0','th1','L'], ['th1','tix','L'], ['tix','th2','L'], ['th2','th3','L'], ['th3','th4','L'], ['th4','tix_s','L'], ['tix_s','th6','L'],
    ['th2','chk','L'], ['th1','chk_n','L'], ['chk_n','a0','S'], ['tix_s','chk_s','L'], ['chk_s','sj','S'],
    // baggage claim, north to south
    ['bg0','bg1','L'], ['bg1','bg2','L'], ['bg2','bg3','L'], ['bg3','bag','L'], ['bag','bg5','L'], ['bg5','bag_s','L'], ['bag_s','bg7','L'], ['c0','c1','C'], ['c1','c2','C'], ['c2','c3','C'], ['c3','c4','C'],
    ['c4','r0','R'], ['r0','r1','R'], ['r1','r2','R'], ['r2','r3','R'], ['r3','r4','R'], ['r4','r5','R'], ['r5','r6','R'], ['r6','r7','R'], ['r7','r8','R'], ['r8','r9','R'], ['r9','r10','R'], ['r10','r11','R'], ['r11','r12','R'], ['r12','r13','R'], ['r13','r14','R'], ['r14','c4','R'],
    ['hub','b0','M'], ['b0','b1','B'], ['b1','b2','B'], ['hub','a0','M'], ['a0','a1','A'], ['a1','a2','A'],
    // escalators between the floors at the north end, the middle (by the Central checkpoint) and the south end,
    // and down to the RTA platform
    ['tix','bg1','X','esc'], ['th3','bg3','X','esc'], ['th6','bag_s','X','esc'], ['bg3','rta','X','esc'],
    // out to ground transportation, the arrivals curb and the taxi stand (by carousel 11)
    ['bg0','gtc','L'], ['bag_s','curb','L'], ['bg7','taxi','L'], ['gtc','rent','L'], ['gtc','hotel','L'], ['bag','ride','L'],
    // elevators (step-free) beside each set of escalators, and to the RTA platform
    ['th0','lift_t','L'], ['lift_t','bg0','X','lift'], ['th3','lift_c','L'], ['lift_c','bg3','X','lift'],
    ['th6','lift_s','L'], ['lift_s','bag_s','X','lift'], ['bg3','lift_r','L'], ['lift_r','rta','X','lift'],
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
  
  // The landside halls: outlines (from OpenStreetMap's terminal and indoor walkways), the names painted
  // on their floors, check-in counter rows, baggage carousels [x, y, angle, number] numbered from the
  // north end (the airport's map puts the taxi stand, at the south end, by carousel 11) and the curbside doors.
  const HALLS = { names: [[98, -118, -78.4, 'TICKETING', 'up'], [86, -30, -78.4, 'TICKETING', 'up'], [157, -186, -44.6, 'TICKETING', 'up'], [81.3, -48.5, -78.4, 'BAGGAGE CLAIM', 'lo'], [160, -193, -44.6, 'BAGGAGE CLAIM', 'lo'], [118, -66, -78.4, 'DEPARTURES · UPPER DRIVE', 'up'], [174, -168, -44.6, 'DEPARTURES · UPPER DRIVE', 'up'], [135.4, -65.7, -78.4, 'ARRIVALS PICKUP · LOWER DRIVE', 'lo'], [193.8, -157.3, -44.6, 'ARRIVALS PICKUP · LOWER DRIVE', 'lo']], "tix":[[114.2,-109.8],[115.9,-109.7],[120.1,-114.5],[122.1,-122.4],[126.9,-127.8],[127.7,-131.3],[125.2,-133.6],[188.1,-196.0],[167.9,-216.9],[102.0,-151.8],[90.7,-138.5],[80.8,-99.2],[63.0,-10.3],[92.3,-4.6]],"bag":[[109.2,0.6],[128.1,-97.3],[142.3,-124.3],[208.0,-190.0],[169.6,-218.2],[147.6,-197.9],[95.7,-146.1],[87.1,-129.3],[83.6,-116.6],[61.6,-7.8]],"counters":[[[148.0,-194.3],[145.2,-191.5],[142.4,-188.6],[139.6,-185.8],[136.8,-182.9],[134.0,-180.1],[131.2,-177.2],[128.4,-174.4],[125.6,-171.5],[122.7,-168.7],[119.9,-165.8],[117.1,-163.0]],[[103.1,-148.7],[100.3,-145.9],[97.5,-143.0],[94.7,-140.2],[91.9,-135.7],[91.1,-131.8],[90.2,-127.8],[89.4,-123.9],[88.5,-120.0],[87.7,-116.1],[86.8,-112.2],[86.0,-108.3],[85.1,-104.4],[84.3,-100.5],[83.4,-96.6],[82.6,-92.7],[81.7,-88.8],[80.9,-84.9],[80.0,-80.9],[79.2,-77.0],[78.3,-73.1],[77.5,-69.2],[76.6,-65.3]],[[72.1,-44.8],[71.3,-40.9],[70.4,-37.0],[69.6,-33.1],[68.7,-29.2],[67.9,-25.2],[67.0,-21.3]]],"carousels":[[174.4,-178.2,135.8,1],[161.1,-165.2,135.8,2],[147.7,-152.3,135.8,3],[134.4,-139.3,135.8,4],[122.8,-128.4,123.0,5],[116.8,-115.8,101.8,6],[113.0,-97.6,101.8,7],[109.2,-79.4,101.8,8],[105.4,-61.2,101.8,9],[101.6,-43.0,101.8,10],[97.8,-24.8,101.8,11]],"doors":{"up":[[187,-195],[157,-165],[130,-139],[110,-93],[101,-49],[92,-4]],"lo":[[201,-182],[173,-155],[142,-124],[128,-97],[121,-64],[115,-36],[109,0]]},"facade":{"up":[[92.3,-4.7],[101.6,-49.2],[110.8,-93.6],[114.2,-109.8],[121.3,-115.9],[126.0,-124.1],[127.8,-131.3],[130.7,-139.0],[157.5,-165.7],[187.4,-195.3],[198.3,-206.2]],"lo":[[109.2,0.6],[115.9,-36.4],[121.9,-64.4],[128.1,-97.3],[142.3,-124.3],[173.7,-155.7],[201.3,-182.7],[208,-190]]},"curb":{"up":[[92.3,-4.7],[114.2,-109.8],[121.3,-115.9],[126.0,-124.1],[130.7,-139.0],[198.3,-206.2],[195.9,-208.6],[127.8,-140.9],[122.8,-125.4],[118.6,-118.1],[111.1,-111.6],[89.0,-5.4]],"lo":[[109.2,0.6],[128.1,-97.3],[142.3,-124.3],[208.0,-190.0],[203.6,-194.1],[137.4,-127.9],[122.4,-99.3],[103.3,-0.5]]},"zebra":{"up":[[95.6,-4.0,99.9,-3.2],[105.0,-48.5,110.0,-47.6],[114.4,-92.9,120.5,-91.8],[133.8,-135.7,137.0,-132.7],[160.5,-162.6,163.7,-159.4],[190.2,-192.6,194.0,-188.4]],"lo":[[144.3,-122.3,148.6,-118.0],[176.0,-153.5,180.0,-149.0],[203.4,-180.4,208.4,-175.6],[131.7,-96.8,137.7,-95.7],[125.2,-63.8,131.1,-62.7],[119.9,-35.8,125.6,-34.8],[112.8,1.1,118.4,1.8]]}};

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
    ['Elevator','service',[77,-23,'LIFT','lift_s'],2,'Ticketing ↔ baggage claim, south end'],
    ['Information desk','service',[152,-190,'L'],5], ["Farmer's Fridge vending",'food',[170,-208,'L'],4], ['Illy Coffee vending','coffee',[160,-210,'L'],4],
    // baggage carousels, and the escalators between ticketing and baggage claim, on both floors
    ...HALLS.carousels.map(([x, y, , n]) => ['Carousel ' + n, 'service', [x, y, 'L', null, 'lo'], 20, n === 11 ? 'Beside the taxi stand' : '']),
    ['Escalators','service',[154,-186,'L',null,'up'],1,'Down to baggage claim'], ['Escalators','service',[156,-184,'L',null,'lo'],1,'Up to ticketing'],
    ['Escalators','service',[99,-127,'L',null,'up'],1,'Down to baggage claim and the RTA'], ['Escalators','service',[101,-124,'L',null,'lo'],1,'Up to ticketing'],
    ['Escalators','service',[78,-30,'L',null,'up'],1,'Down to baggage claim'], ['Escalators','service',[80,-28,'L',null,'lo'],1,'Up to ticketing'],
    ['Welcome Center','service',[108,-58,'L',null,'lo'],5], ['Hudson Aero Mart','shop',[104,-84,'L',null,'lo']], ['SIM card vending','service',[110,-96,'L',null,'lo'],5],
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
    amenLevel: it => it.floor || 'up',
    LOWER_V: ['bg0', 'bg1', 'bg2', 'bg3', 'bg5', 'bag_s', 'bg7', 'bag', 'rta', 'gtc', 'taxi', 'rent', 'hotel', 'ride', 'curb', 'lift_r'],
    PLACES: ['chk', 'chk_s', 'chk_n', 'tix', 'bag', 'rta', 'gtc', 'taxi', 'rent', 'hotel', 'ride', 'curb'],
    // how each place is drawn: [icon, kind]; kinds set the sign colour (terminal, bags, transit, ground)
    PLACE_STYLE: { chk: ['shield', 'terminal'], chk_s: ['shield', 'terminal'], chk_n: ['shield', 'terminal'], tix: ['ticket', 'terminal'], bag: ['bag', 'bags'], rta: ['train', 'transit'],
      gtc: ['bus', 'ground'], taxi: ['taxi', 'ground'], rent: ['key', 'ground'], hotel: ['bed', 'ground'], ride: ['phone', 'ground'], curb: ['car', 'ground'] },
    basemap: BASEMAP_CLE,
    // node roles the engine needs: security checkpoint, airside hub, baggage claim, ticketing
    // posted hours (airport time); routes go through whichever open one is quickest. North opens only
    // at busy times, so routes avoid it unless you start or end there.
    CHECKPOINTS: { chk: { open: '4:00', close: '22:00' }, chk_s: { open: '3:30', close: '19:45' }, chk_n: { busy: true } },
    roles: { checkpoint: 'chk', hub: 'hub', baggage: 'bag', ticketing: 'tix', transit: 'rta' },
    ui: {
      // [x, y, text, anchor, floor]; no floor means both
      labels: [[150, -95, 'Main terminal', , 'up'], [-185, 271, 'Rotunda'], [255, -40, 'Parking garage'], [125, 385, 'Concourse D · closed'], [140, 60, 'Lower Drive']],
      roundels: [['A', 118, -458], ['B', -236, -171], ['C', 72, 28]],
      halls: HALLS,
      securityLine: [[96, -162, 112, -138], [120, -213, 120, -197], [63, -60, 63, -46]],
      closedTerms: ['termD'],
      airlinesNote: 'All three concourses connect past security, so you can walk between them.',
      airlinesTip: 'International arrivals clear U.S. Customs near gate A5. Concourse D has been closed since 2014.',
      defaults: { from: 'v:chk', to: 'g:C22', gate: 'g:C22', arrGate: 'g:B6' },
      popular: ['v:chk', 'v:bag', 'v:rta'], popularRe: /Great Lakes|Bar Symon|Rock & Roll/,
      floors: { up: 'Upper level · gates, security, ticketing', lo: 'Lower level · baggage claim, ground transportation, RTA' },
      // arrivals destinations: [place id, label, tip]
      arrivals: [
        ['v:rta', 'RTA Red Line to downtown', 'Red Line trains run to downtown (Tower City) in about 25 minutes. Buy a fare at the machines before you board.'],
        ['v:ride', 'Rideshare (Uber, Lyft)', 'Pickups are at the curb outside baggage claim; your app shows the exact spot, so request once you have your bags.'],
        ['v:taxi', 'Taxi', 'Taxis wait at the stand on Lower Drive.'],
        ['v:curb', 'Someone picking me up', 'Arrivals pickup is on Lower Drive. Drivers can wait in the free cell phone lot until you’re outside.'],
        ['v:rent', 'Rental car shuttle', 'Free shuttles to the Rental Car Center leave from the Ground Transportation Center, at the north end of baggage claim, around the clock (5–7 min ride).'],
        ['v:hotel', 'Hotel or parking shuttle', 'Hotel and off-airport parking shuttles stop at the Ground Transportation Center, at the north end of baggage claim.'],
        ['v:bag', 'Meeting someone at baggage claim', 'Baggage claim is on the lower level, past the escalators.'],
      ],
      // extra notes for particular route steps at this airport
      stepNote(n, path, i) {
        if (n === 'c4') return 'Gates C17–C29 ring the rotunda';
        if (n === 'gtc') return 'North end of baggage claim, past carousel 1';
        if (n === 'fc' && path.includes('c0')) return 'Follow the purple C signs';
        if (n === 'lift_r') return path[i + 1] === 'rta' ? 'Take the elevator down to the RTA platform' : 'Take the elevator up to baggage claim';
        return '';
      },
    },
  };
})();
