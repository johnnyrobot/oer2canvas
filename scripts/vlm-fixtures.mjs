/**
 * Small, openly licensed fixture set for the local VLM release gate.
 *
 * These are project-authored SVG teaching figures (CC0), not claims about a
 * publisher's content. They make the benchmark runnable without uploading
 * copyrighted textbook pages and give a reviewer a stable 30-item baseline.
 * Before making local drafting default-on, add representative publisher
 * figures beside this set and repeat the same blinded review.
 */

const escapeXml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;')

function visualFor(category, labels) {
  const [a = '', b = '', c = '', d = ''] = labels
  if (category === 'chart') {
    return `<line x1="72" y1="220" x2="72" y2="62" stroke="#172033" stroke-width="3"/><line x1="72" y1="220" x2="500" y2="220" stroke="#172033" stroke-width="3"/><polyline points="95,190 180,168 265,178 350,120 455,92" fill="none" stroke="#1769aa" stroke-width="5"/><circle cx="95" cy="190" r="6" fill="#1769aa"/><circle cx="180" cy="168" r="6" fill="#1769aa"/><circle cx="265" cy="178" r="6" fill="#1769aa"/><circle cx="350" cy="120" r="6" fill="#1769aa"/><circle cx="455" cy="92" r="6" fill="#1769aa"/><text x="80" y="245" font-family="Arial" font-size="14">${escapeXml(a)}</text><text x="210" y="245" font-family="Arial" font-size="14">${escapeXml(b)}</text><text x="340" y="245" font-family="Arial" font-size="14">${escapeXml(c)}</text><text x="80" y="78" font-family="Arial" font-size="14">${escapeXml(d)}</text>`
  }
  if (category === 'anatomy') {
    return `<ellipse cx="230" cy="150" rx="92" ry="72" fill="#f6d8df" stroke="#8a2942" stroke-width="4"/><circle cx="205" cy="142" r="24" fill="#d6e8f7" stroke="#1769aa" stroke-width="3"/><path d="M300 100 Q370 135 300 198" fill="none" stroke="#1769aa" stroke-width="8"/><line x1="330" y1="125" x2="470" y2="88" stroke="#172033" stroke-width="2"/><line x1="205" y1="142" x2="60" y2="92" stroke="#172033" stroke-width="2"/><line x1="280" y1="190" x2="455" y2="205" stroke="#172033" stroke-width="2"/><text x="475" y="92" font-family="Arial" font-size="14">${escapeXml(a)}</text><text x="24" y="96" font-family="Arial" font-size="14">${escapeXml(b)}</text><text x="460" y="210" font-family="Arial" font-size="14">${escapeXml(c)}</text>`
  }
  if (category === 'chemistry') {
    return `<circle cx="150" cy="145" r="34" fill="#d6e8f7" stroke="#1769aa" stroke-width="4"/><circle cx="340" cy="95" r="27" fill="#f6d8df" stroke="#8a2942" stroke-width="4"/><circle cx="340" cy="195" r="27" fill="#f6d8df" stroke="#8a2942" stroke-width="4"/><line x1="182" y1="130" x2="315" y2="103" stroke="#172033" stroke-width="5"/><line x1="182" y1="160" x2="315" y2="187" stroke="#172033" stroke-width="5"/><text x="138" y="151" font-family="Arial" font-size="18">${escapeXml(a)}</text><text x="330" y="101" font-family="Arial" font-size="16">${escapeXml(b)}</text><text x="330" y="201" font-family="Arial" font-size="16">${escapeXml(c)}</text><text x="400" y="155" font-family="Arial" font-size="18">${escapeXml(d)}</text>`
  }
  if (category === 'map') {
    return `<path d="M55 70 L185 45 L310 78 L470 50 L500 220 L355 242 L220 210 L70 235 Z" fill="#e6f0d6" stroke="#4b6b39" stroke-width="3"/><path d="M85 190 C180 132 240 210 330 142 S420 110 480 165" fill="none" stroke="#1769aa" stroke-width="7"/><path d="M115 92 L230 125 L330 95" fill="none" stroke="#8a2942" stroke-width="4" stroke-dasharray="8 6"/><circle cx="230" cy="125" r="9" fill="#8a2942"/><text x="74" y="62" font-family="Arial" font-size="14">N</text><text x="400" y="82" font-family="Arial" font-size="14">${escapeXml(a)}</text><text x="340" y="140" font-family="Arial" font-size="14">${escapeXml(b)}</text><text x="238" y="120" font-family="Arial" font-size="14">${escapeXml(c)}</text>`
  }
  if (category === 'math') {
    return `<line x1="70" y1="220" x2="70" y2="55" stroke="#172033" stroke-width="3"/><line x1="70" y1="150" x2="500" y2="150" stroke="#172033" stroke-width="3"/><path d="M95 90 Q180 220 265 90 Q350 -20 470 105" fill="none" stroke="#1769aa" stroke-width="5"/><line x1="90" y1="205" x2="460" y2="72" stroke="#8a2942" stroke-width="4"/><text x="460" y="70" font-family="Arial" font-size="14">${escapeXml(a)}</text><text x="82" y="168" font-family="Arial" font-size="14">${escapeXml(b)}</text><text x="310" y="205" font-family="Arial" font-size="14">${escapeXml(c)}</text><text x="350" y="45" font-family="Arial" font-size="14">${escapeXml(d)}</text>`
  }
  if (category === 'table') {
    const rows = [a, b, c, d].filter(Boolean)
    return `<rect x="70" y="62" width="410" height="154" fill="#f9fbfd" stroke="#172033" stroke-width="3"/><line x1="70" y1="100" x2="480" y2="100" stroke="#172033" stroke-width="2"/><line x1="70" y1="138" x2="480" y2="138" stroke="#172033" stroke-width="2"/><line x1="70" y1="176" x2="480" y2="176" stroke="#172033" stroke-width="2"/><line x1="205" y1="62" x2="205" y2="216" stroke="#172033" stroke-width="2"/><text x="84" y="88" font-family="Arial" font-size="14">Category</text><text x="220" y="88" font-family="Arial" font-size="14">Value</text>${rows.map((row, index) => `<text x="84" y="${126 + index * 38}" font-family="Arial" font-size="13">${escapeXml(row)}</text>`).join('')}`
  }
  return `<circle cx="120" cy="130" r="54" fill="#f4c95d"/><circle cx="250" cy="100" r="42" fill="#5ab1bb"/><circle cx="365" cy="155" r="64" fill="#ed6a5a"/><path d="M60 220 Q240 30 470 220" fill="none" stroke="#172033" stroke-width="5" opacity=".45"/>`
}

function makeFixture(spec) {
  const title = escapeXml(spec.title)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="280" viewBox="0 0 560 280"><rect width="560" height="280" fill="white"/><text x="24" y="26" font-family="Arial,sans-serif" font-weight="700" font-size="17" fill="#172033">${title}</text>${visualFor(spec.category, spec.labels)}</svg>`
  return Object.freeze({
    ...spec,
    license: 'CC0-1.0',
    source: 'Project-authored synthetic educational fixture',
    svg,
  })
}

const specs = [
  { id: 'chart-01', category: 'chart', title: 'Enrollment by year', labels: ['2010', '2020', '2030', 'students'], expectedFacts: ['The horizontal axis shows years 2010, 2020, and 2030.', 'The vertical measure is students.', 'The plotted trend ends higher than it begins.'], referenceDescription: 'A line chart of student enrollment over 2010, 2020, and 2030; the final point is higher than the first.' },
  { id: 'chart-02', category: 'chart', title: 'Monthly rainfall', labels: ['March', 'June', 'September', 'millimeters'], expectedFacts: ['The horizontal categories are March, June, and September.', 'The vertical measure is millimeters.', 'June is the highest plotted category.'], referenceDescription: 'A chart comparing monthly rainfall in millimeters, with June higher than March and September.' },
  { id: 'chart-03', category: 'chart', title: 'Study time and score', labels: ['hours', 'score', 'positive trend', 'grade'], expectedFacts: ['The horizontal variable is study hours.', 'The vertical variable is score.', 'The points show a generally positive relationship.'], referenceDescription: 'A scatter plot relating study hours to score, with an overall upward trend.' },
  { id: 'chart-04', category: 'chart', title: 'Household energy sources', labels: ['solar', 'wind', 'coal', 'percent'], expectedFacts: ['The categories include solar, wind, and coal.', 'The measure is percent.', 'The figure is a comparison of energy sources.'], referenceDescription: 'A chart comparing household energy-source shares for solar, wind, and coal as percentages.' },
  { id: 'chart-05', category: 'chart', title: 'Temperature and altitude', labels: ['altitude', 'temperature', 'decreases', 'degrees'], expectedFacts: ['The horizontal variable is altitude.', 'The vertical variable is temperature.', 'The plotted relationship decreases as altitude increases.'], referenceDescription: 'A line chart showing temperature decreasing as altitude increases.' },
  { id: 'anatomy-01', category: 'anatomy', title: 'Simplified heart diagram', labels: ['ventricle', 'atrium', 'artery'], expectedFacts: ['The diagram labels a ventricle.', 'The diagram labels an atrium.', 'An artery is shown leaving the organ.'], referenceDescription: 'A simplified heart diagram with an atrium, a ventricle, and an artery.' },
  { id: 'anatomy-02', category: 'anatomy', title: 'Animal cell', labels: ['nucleus', 'cell membrane', 'cytoplasm'], expectedFacts: ['A nucleus is labeled inside the cell.', 'The outer boundary is the cell membrane.', 'The interior region is cytoplasm.'], referenceDescription: 'A simplified animal cell with labels for nucleus, cell membrane, and cytoplasm.' },
  { id: 'anatomy-03', category: 'anatomy', title: 'Leaf cross-section', labels: ['stoma', 'epidermis', 'vascular bundle'], expectedFacts: ['A stoma is labeled.', 'The outer layer is called epidermis.', 'A vascular bundle is identified.'], referenceDescription: 'A leaf cross-section identifying a stoma, epidermis, and vascular bundle.' },
  { id: 'anatomy-04', category: 'anatomy', title: 'Heating a solution', labels: ['thermometer', 'beaker', 'solution'], expectedFacts: ['A thermometer is shown.', 'The liquid is contained in a beaker.', 'The beaker contains a solution.'], referenceDescription: 'A laboratory setup showing a thermometer in a beaker of solution.' },
  { id: 'anatomy-05', category: 'anatomy', title: 'Water cycle', labels: ['evaporation', 'condensation', 'precipitation'], expectedFacts: ['Evaporation is labeled.', 'Condensation is labeled.', 'Precipitation is labeled.'], referenceDescription: 'A water-cycle diagram naming evaporation, condensation, and precipitation.' },
  { id: 'chemistry-01', category: 'chemistry', title: 'Water molecule', labels: ['H', 'O', 'H', 'H-O-H'], expectedFacts: ['The molecule contains two hydrogen atoms.', 'The central atom is oxygen.', 'The structure is shown as H-O-H.'], referenceDescription: 'A water molecule with oxygen between two hydrogen atoms, represented as H-O-H.' },
  { id: 'chemistry-02', category: 'chemistry', title: 'Methane molecule', labels: ['C', 'H', 'H', 'CH4'], expectedFacts: ['The central atom is carbon.', 'Hydrogen atoms surround the carbon.', 'The formula shown is CH4.'], referenceDescription: 'A methane molecule with a central carbon, surrounding hydrogen atoms, and the formula CH4.' },
  { id: 'chemistry-03', category: 'chemistry', title: 'Simple reaction', labels: ['reactant A', 'reactant B', 'product C', 'A+B→C'], expectedFacts: ['Two reactants are labeled A and B.', 'The product is labeled C.', 'The reaction arrow points from reactants to product.'], referenceDescription: 'A schematic reaction in which reactants A and B combine to form product C.' },
  { id: 'chemistry-04', category: 'chemistry', title: 'Periodic-table excerpt', labels: ['group', 'period', 'element', 'atomic number'], expectedFacts: ['The figure identifies a group.', 'The figure identifies a period.', 'An element and its atomic number are shown.'], referenceDescription: 'A simplified periodic-table excerpt identifying group, period, an element, and atomic number.' },
  { id: 'map-01', category: 'map', title: 'River basin map', labels: ['river', 'town', 'basin', 'north'], expectedFacts: ['A river crosses the basin.', 'A town is marked.', 'The map includes a north indicator.'], referenceDescription: 'A map of a river basin with a river, a marked town, and a north indicator.' },
  { id: 'map-02', category: 'map', title: 'Migration route', labels: ['origin', 'route', 'destination', 'north'], expectedFacts: ['An origin is marked.', 'A dashed route connects origin and destination.', 'The map includes a north indicator.'], referenceDescription: 'A map showing a dashed migration route from an origin to a destination.' },
  { id: 'timeline-01', category: 'map', title: 'Technology timeline', labels: ['1900', '1950', '2000', 'events'], expectedFacts: ['The timeline includes 1900.', 'The timeline includes 1950.', 'The timeline includes 2000.'], referenceDescription: 'A timeline marking events at 1900, 1950, and 2000.' },
  { id: 'map-03', category: 'map', title: 'Rock-cycle pathway', labels: ['magma', 'weathering', 'sediment', 'north'], expectedFacts: ['Magma is identified.', 'Weathering is identified.', 'Sediment is identified.'], referenceDescription: 'A process map naming magma, weathering, and sediment in a rock-cycle pathway.' },
  { id: 'math-01', category: 'math', title: 'Quadratic and line', labels: ['y=x²', 'x-axis', 'positive slope', 'y-axis'], expectedFacts: ['A quadratic curve is shown.', 'The x-axis and y-axis are shown.', 'A separate line has positive slope.'], referenceDescription: 'A coordinate-plane figure with a quadratic curve and a separate positively sloped line.' },
  { id: 'math-02', category: 'math', title: 'Right triangle', labels: ['hypotenuse', 'leg', 'right angle', '3-4-5'], expectedFacts: ['The figure is a right triangle.', 'A hypotenuse is labeled.', 'The side-length set is 3-4-5.'], referenceDescription: 'A right triangle illustrating the 3-4-5 side-length relationship and a labeled hypotenuse.' },
  { id: 'math-03', category: 'math', title: 'Linear function', labels: ['slope', 'intercept', 'x-axis', 'y-axis'], expectedFacts: ['The graph has a positive slope.', 'An intercept is identified.', 'The x-axis and y-axis are shown.'], referenceDescription: 'A coordinate graph of a linear function with positive slope, including an intercept.' },
  { id: 'math-04', category: 'math', title: 'Unit-circle axes', labels: ['radius 1', 'origin', 'x-axis', 'y-axis'], expectedFacts: ['The radius is 1.', 'The origin is identified.', 'The x-axis and y-axis are shown.'], referenceDescription: 'A unit-circle coordinate diagram identifying radius 1, the origin, and both axes.' },
  { id: 'math-05', category: 'math', title: 'Fraction number line', labels: ['0', '1/2', '1', 'number line'], expectedFacts: ['The number line includes 0.', 'The midpoint is labeled 1/2.', 'The number line includes 1.'], referenceDescription: 'A number line from 0 to 1 with the midpoint labeled one-half.' },
  { id: 'table-01', category: 'table', title: 'Species observations', labels: ['sparrow', '12', 'oak', '7'], expectedFacts: ['The table includes sparrow.', 'The sparrow value is 12.', 'The table includes oak with value 7.'], referenceDescription: 'A small table listing observations for sparrow (12) and oak (7).' },
  { id: 'table-02', category: 'table', title: 'Experiment results', labels: ['control', '18', 'treated', '31'], expectedFacts: ['The table includes a control group.', 'The control value is 18.', 'The treated value is 31.'], referenceDescription: 'A results table comparing control (18) and treated (31) groups.' },
  { id: 'table-03', category: 'table', title: 'Two-panel comparison', labels: ['panel A', 'before', 'panel B', 'after'], expectedFacts: ['Panel A is labeled.', 'Panel B is labeled.', 'The comparison uses before and after labels.'], referenceDescription: 'A two-panel comparison labeled panel A before and panel B after.' },
  { id: 'table-04', category: 'table', title: 'Material properties', labels: ['material', 'density', 'wood', 'metal'], expectedFacts: ['The table has a material column.', 'Density is a property column.', 'Wood and metal are listed.'], referenceDescription: 'A comparison table of material properties including density for wood and metal.' },
  { id: 'decorative-01', category: 'decorative', title: 'Abstract circles', labels: [], expectedFacts: [], referenceDescription: 'Decorative colored circles with no instructional information.', decorative: true },
  { id: 'decorative-02', category: 'decorative', title: 'Decorative wave', labels: [], expectedFacts: [], referenceDescription: 'A decorative wave pattern with no instructional information.', decorative: true },
  { id: 'decorative-03', category: 'decorative', title: 'Color blocks', labels: [], expectedFacts: [], referenceDescription: 'A set of decorative color blocks with no instructional information.', decorative: true },
]

export const VLM_FIXTURES = Object.freeze(specs.map(makeFixture))

export function fixtureDataUrl(fixture) {
  return `data:image/svg+xml;base64,${Buffer.from(fixture.svg, 'utf8').toString('base64')}`
}
