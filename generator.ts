/*
Necessary components:
CORE 
- Generate rapid positon (G00)
- Generate linear interpolation (G01)
- Generate box cut cycle (G74)
- Generate contour cut cycle (G75)
BASE OPERATIONS (combinations of core functions)
- Generate roughing (cylindrical) pass (replaced by G74/75)
- Generate contour/finishing pass
LARGER OPERATIONS
- Generation of section cycle (machining one section defined by stickout)
- Division of provided points into sections
- Generation of full code (using previous two concepts)

Generation of code will require semi-fixed and variable data.
Semi-fixed data:
    - Cut depths
    - Feed rates
    - Safe clearances
    - Part stickout
Variable data:
    - Stock diameter
    - Diameter measurements
    - Optional: Positions of diameter measurements
*/


/*
Overview of process as understood by me:
- Begin by arranging data into a unified array of DimensionPoint objects
- Perform basic checks of material dimensions vs points
- Divide into sections based on pull length (should be able to leave last one as short one)
- Generate beginning code:
    - Basic overall settings
- Generate cycle codes:
    - Set zeroing location
    - Pause program
    - Back off to safe location
    - Start spindle
    - Roughing and finishing passes
    - Move to safe location
    - Stop spindle
- Cleanup:
    - End of program stop
    - ?
*/

/*
Until further input, I will be treating the set home position as:
    X = 0 is the axis of rotation
    Z = 0 is the face of the workpiece when pulled out to the length denoted by "stickout"
*/

class MovePoint {
    x: number | undefined
    y: number | undefined
    z: number | undefined
    axesPresent: {
        x: boolean,
        y: boolean,
        z: boolean
    }
    
    constructor (x?: number, y?: number, z?: number) {
        if (arguments.length === 0) {
            throw new SyntaxError("Cannot create MovePoint with no elements")
        }
        this.x = x
        this.y = y
        this.z = z
        this.axesPresent = {x: x !== undefined, y: y !== undefined, z: z !== undefined}
    }
}

class DimensionPoint {
    x: number
    z: number

    constructor (x: number, z: number) {
        this.x = x
        this.z = z
    }

    getMovePoint(): MovePoint {
        return new MovePoint(this.x, undefined, this.z)
    }
}

class Section {
    // Points in traditional format, with first point at z = 0 and last at z = length
    points: DimensionPoint[]
    // Modified version of points array, offset by stickout and sorted by descending z to allow ease of access for machining operations
    machiningPoints: DimensionPoint[]

    // General data about the points in the section
    length: number
    maxDiameter: number

    constructor (points: DimensionPoint[]) {
        // Set basic points array
        this.points = points

        // General data
        this.length = Math.max(...(points.map( (point) => point.z)))
        this.maxDiameter = Math.max(...(points.map( (point) => point.x)))

        // Create a deep copy of each point for machiningPoints
        // Z values are negated and offset to match original range to maintain intended cut order
        this.machiningPoints = []
        this.points.forEach(point => {
            this.machiningPoints.push(new DimensionPoint(point.x, -point.z + this.length))
        })
        this.machiningPoints.sort((a, b) => b.z - a.z)
        this.machiningPoints.forEach(point => {
            point.z -= global.stickout
        })
    }

    // Provides point in format offset in Z axis such that z values' range is [-length, 0]
    getLengthOffsetPoint(index: number): DimensionPoint {
        return new DimensionPoint(this.points[index].x, this.points[index].z - this.length)
    }
}


// CONSTANTS
// TODO: get colletShift measured, also check if that needs to be a function of delta diameter
const global = {
    depths: {
        max: 0.040,
        min: 0.010
    },
    spacing: {
        xClearance: 0.010,
        zClearance: 0.100,
        colletShift: 0.050
    },
    feed: 0.002,
    rpm: 1500,
    stickout: 1.000,
    decimals: 4,
    G75Functional: false
}

var state: {
    lastGCode: string,
    lastFeed: number,
    position: {
        x: number | undefined,
        y: number | undefined,
        z: number | undefined
    }
} = {
    lastGCode: "None",
    lastFeed: -1,
    position: {
        x: undefined,
        y: undefined,
        z: undefined
    }
}

function rapidPosition(point: MovePoint, comment?: string): string {
    // Check that of present axes, at least one is separate from the current position
    if (
        (!point.axesPresent.x || point.x === state.position.x) &&
        (!point.axesPresent.y || point.y === state.position.y) &&
        (!point.axesPresent.z || point.z === state.position.z)
    ) {
        return ""
    }
    
    let code: string = ""

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (state.lastGCode != "00") {
        code += "G00"
    }

    // Insert axis data where present and new
    if (point.axesPresent.x && point.x !== state.position.x) {
        code += "X" + (+point.x!.toFixed(global.decimals))
    }
    if (point.axesPresent.y && point.y !== state.position.y) {
        code += "Y" + (+point.y!.toFixed(global.decimals))
    }
    if (point.axesPresent.z && point.z !== state.position.z) {
        code += "Z" + (+point.z!.toFixed(global.decimals))
    }
    
    // Insert comment if present
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }

    // Close line of code
    code += "\n"

    // Set last G code used and reset feed rate
    state.lastGCode = "00"
    state.lastFeed = -1

    return code
}

function linearInterpolation(point: MovePoint, feed?: number, comment?: string): string {
    // Check that of present axes, at least one is separate from the current position
    if (
        (!point.axesPresent.x || point.x === state.position.x) &&
        (!point.axesPresent.y || point.y === state.position.y) &&
        (!point.axesPresent.z || point.z === state.position.z)
    ) {
        return ""
    }

    let code = ""

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (state.lastGCode != "01") {
        code += "G01"
    }

    // Insert axis data where present and new
    if (point.axesPresent.x && point.x !== state.position.x) {
        code += "X" + (+point.x!.toFixed(global.decimals))
    }
    if (point.axesPresent.y && point.y !== state.position.y) {
        code += "Y" + (+point.y!.toFixed(global.decimals))
    }
    if (point.axesPresent.z && point.z !== state.position.z) {
        code += "Z" + (+point.z!.toFixed(global.decimals))
    }

    // Insert feed rate if present and changed
    if (typeof feed !== 'undefined' && feed != state.lastFeed) {
        code += "F" + (+feed.toFixed(global.decimals))
    }

    // Insert comment if present
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }

    // Close line of code
    code += "\n"

    // Set last G code used and feed rate
    state.lastGCode = "01"
    state.lastFeed = (feed === undefined ? -1 : feed)

    return code
}

function boxCycle(startPoint: DimensionPoint, endPoint: DimensionPoint, finishBufferRadius: number, feed: number, comment?: string): string {
    // Set initial position with rapid positioning
    let code: string = rapidPosition(startPoint.getMovePoint())

    // Set up 
    code += "G74"
    code += "X" + (+endPoint.x.toFixed(global.decimals))
    code += "X" + (+endPoint.z.toFixed(global.decimals))
    code += "I" + (+(global.depths.max / 2).toFixed(global.decimals))
    code += "U" + (+finishBufferRadius.toFixed(global.decimals))
    code += "F" + (+feed.toFixed(global.decimals))

    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }
    
    // Close line of code
    code += "\n"

    // Reset last used function for safety
    state.lastGCode = "None"

    return code
}

// TODO: Decide if this should be built around sections or points
/**
 * Generates a G75 contour cycle for a specified section.
 * The cutter is returned to the start point by the G75 cycle.
 *
 * @param startPoint The initial position of the cutter, defining the oustide axes of material to be removed.
 * @param points The points defining the inside contour of material removal.
 * @param subroutineID Not currently in use due to subroutine functionality being unclear.  The number to use as a label for the subroutine.
 * @return Code setting the initial position and running the G75 process.
 */
function contourCycle(startPoint: DimensionPoint, points: DimensionPoint[], subroutineID: number, finishBufferRadius: number, feed: number, comment?: string): string {
    let code: string = ""

    // If G75 works, do this the easy way
    if (global.G75Functional) {
        // Set initial position
        code += linearInterpolation(startPoint.getMovePoint(), feed, "Beginning G75 contour cycle")

        // Set up 
        code += "G75"
        code += "I" + (+(global.depths.max / 2).toFixed(global.decimals))
        code += "U" + (+finishBufferRadius.toFixed(global.decimals))
        code += "F" + (+feed.toFixed(global.decimals))
        // Subroutines currently disabled
        // code += "P" + (+subroutineID.toFixed(global.decimals))

        if (typeof comment !== 'undefined') {
            code += "(" + comment + ")"
        }

        // Close line of code
        code += "\n"

        // Reset last used function for safety
        state.lastGCode = "None"

        code += taperSubroutine(subroutineID, points)
    }

    // Otherwise, G75 is not available, use custom simulated version (comment for reference in code)
    else {
        code += linearInterpolation(startPoint.getMovePoint(), feed, "Simulated G75 Contour cycle" + (comment === undefined ? "" : " - " + comment))
        code += simG75(points, global.depths.max / 2, finishBufferRadius, feed)
    }
    
    return code
}

// TODO: sections vs points continues to here
function taperSubroutine(id: number, points: DimensionPoint[]): string {
    // Removing subroutine formatting (added in G3?), using RF to close
    // let code = "}" + id + "\n"
    let code: string = ""

    points.forEach(point => {
        code += "X" + (+point.x.toFixed(global.decimals)) + "Z" + (+point.z.toFixed(global.decimals)) + "\n"
    })

    code += "RF\n"
    // code += "M99\n"
    
    return code
}

/**
 * Manually simulates a G75 cycle, with some changes to improve functionality
 *
 * @param points The points defining the inside contour of material removal.
 * @param I is the maximum amount to be roughed per pass, defined as the depth of cut per side
 * @param U is the amount to be left on the part for the a finish pass
 * @param F is the feedrate
 * @return Code simulating a G75 cycle through G74 and manual cutter moves.
 */
function simG75(points: DimensionPoint[], I: number, U: number, F: number) {
    /** Basic implementation will be:
     *  - If there is a block of material to remove, use G74 to bring down to maximum diameter of taper (with 2U left)
     *  - Create function to break up taper into multiple scaled passes, with max depth being I and offset by 2 * U
     *  - Run basicTaper over each
     */

    let code: string = ""
    let finishSpacedPoints: DimensionPoint[] = points.map(point => new DimensionPoint(point.x + 2 * U, point.z))
    let maxDiam: number = Math.max(...finishSpacedPoints.map(point => point.x))
    let clearZ: number = Math.min(...finishSpacedPoints.map(point => point.z))
    let origPoint: MovePoint = new MovePoint(state.position.x, state.position.y, state.position.z)
    // If there is material to be removed via G74 
    if ((origPoint.x !== undefined) && (maxDiam < origPoint.x)) {
        code += `G74X${maxDiam}Z${clearZ}I${I}U${0}F${F}\n`
    }

    // Generate tapered cutting passes
    let passes: DimensionPoint[][] = genMultiPassPoints(points.map(point => new DimensionPoint(point.x + 2 * U, point.z)), maxDiam, I)
    for (let pass of passes) {
        code += basicTaper(pass.map(point => point.getMovePoint()), F)
        code += linearInterpolation(new MovePoint(maxDiam + global.spacing.xClearance), F)
        code += rapidPosition(new MovePoint(undefined, undefined, origPoint.z! + global.spacing.zClearance))
    }

    // Return to original position
    code += linearInterpolation(origPoint, F)
}

/**
 * Helper function to generate points for a set of passes with the specified maximum cut depth
 *
 * @param points The points defining the contour to be scaled into suitable passes.
 * @param startX The starting plane of the passes (each point being a scaled value between this and the final cut point)
 * @param I is the maximum amount to be roughed per pass, defined as the depth of cut per side
 * @return A 2D array of DimensionPoints, each top-level element containing an array of DimensionPoints representing a cutting pass.
 */
function genMultiPassPoints(points: DimensionPoint[], startX: number, I: number): DimensionPoint[][] {
    let xVals: number[] = points.map(point => point.x)
    let numPasses: number = Math.ceil((startX - Math.min(...xVals)) / (2 * I))
    let xDeltas: number[] = xVals.map(val => (startX - val) / numPasses)

    var retArray: DimensionPoint[][] = []
    // For all but last pass, calculate via this method
    for (let i: number = 1; i < numPasses; i++) {
        var tempArray: DimensionPoint[] = []
        tempArray.push(...xDeltas.map((delta, index) => {
            return new DimensionPoint(startX - i * delta, points[index].z)
        }))
        retArray.push(tempArray)
    }
    // For last pass, add original points to ensure accurate final sizing
    retArray.push(points)

    return retArray
}

/**
 * Generates a basic set of linear movements between the specified points.
 * Cutter position at call time is assumed to be a safe location for movement to start point.
 * The cutter is returned to the z position of the start value, and an x clearanced above the maximum level of the taper
 *
 * @param points The set of points the cutter will travel along.
 * @param feed The feed rate to be used in the linear interpolations.
 * @return Code directing the cutter to follow the specified taper and return to a safe location.
 */
function basicTaper(points: MovePoint[], feed: number): string {
    let code: string = ""
    let startZ = state.position.z

    // Run path, beginning with movement to start point
    points.forEach(point => {
        code += linearInterpolation(point, feed)
    })

    // Return to clearanced version of start location
    code += linearInterpolation(new MovePoint(Math.max(...points.map(point => point.x!)) + global.spacing.xClearance))
    code += rapidPosition(new MovePoint(undefined, undefined, startZ))
    return code
}

function sectionCycle(startDiameter: number, section: Section, subroutineID: number): string {
    // Confirm that points in section will be accurately cut into material
    if (section.maxDiameter > startDiameter) {
        throw new RangeError("Provided taper includes diameter(s) exceeding provided start diameter, taper will not be accurate!")
    }

    /*
    - Set zeroing location
    - Pause program for stock pull/insertion
    - Back off to safe location
    - Start spindle
    - Roughing and finishing passes
    - Move to safe location
    - Stop spindle
    */

    let code = ""
    // Set pull location for current section.  This will be the point in the section with the highest z value.
    // To do this with the spindle stopped, this needs to be in IPM instead of IPR
    code += `G94F${global.rpm * global.feed}\n`
    code += linearInterpolation(new MovePoint(section.machiningPoints[0].x + global.spacing.xClearance, undefined, section.machiningPoints[0].z))
    
    // Pause program for stock pull/insertion
    code += "M01(Move stock to appropriate position)\n"
    
    // Move to safe starting point
    code += linearInterpolation(new MovePoint(startDiameter + global.spacing.xClearance, undefined, section.length - global.stickout + global.spacing.zClearance))

    // Begin running spindle and set feed rate/type
    code += `M03S${global.rpm}\n`
    code += `G95F${global.feed}\n`

    // Run G75 roughing cycle
    code += contourCycle(
        new DimensionPoint(startDiameter + global.spacing.xClearance, section.length - global.stickout + global.spacing.zClearance),
        section.machiningPoints,
        subroutineID,
        global.depths.max / 4,
        global.feed)

    // Run finishing pass
    code += basicTaper(section.machiningPoints.map(point => point.getMovePoint()), global.feed)

    // Return cutter to safe position for stock movement (already moved away from contact with part)
    code += rapidPosition(new MovePoint(startDiameter + global.spacing.xClearance, undefined, global.spacing.zClearance))
    
    // Stop spindle
    code += "M05\n"

    return code
}

/**
 * Generates a set of sections defined by the stickout length, using provided points and interpolating as necessary
 *
 * @param xPoints Array of points representing the x axis values (diameters).
 * @param zPoints Array of points representing the y axis values (positions).
 * @return An array of Sections representing the provided points.  Coordinate system within each section has first point at z=0, increasing from there
 */
function interpolatePoints(xPoints: number[], zPoints: number[]): Section[] {
    // Determine how many sections we need to create, with the final section being the one to potentially be shorter than sectionLength
    let fullLength: number = Math.max(...zPoints)
    var numSections: number = Math.ceil(fullLength / global.stickout)

    var startPoint: number[] = [xPoints[0], zPoints[0]]
    var startIndex: number = 0
    var endPoint: number[] = [0, 0]
    var endIndex: number = 0
    
    // This variable collects the separate xPoints and zPoints arrays into a single array of individual x-z points
    var organizedPoints: DimensionPoint[] = []
    for (let i = 0; i < xPoints.length; i++) {
        organizedPoints.push(new DimensionPoint(xPoints[i], zPoints[i]));
    }

    // This will collect the lists of points broken into sections
    var sections: Section[] = [];
    // Storage for points in each section
    var includedPoints: DimensionPoint[] = [];

    // We need to iterate through each section and collect the data points included in it (potentially interpolating start/end points)
    // Base cases are the first and last elements:
    // First element can assume that the start point is our first point, only needs to calculate end point
    // Last element can assume that the end point is our last point, reuse previous end point as start
    
    // General cycle will be: Grab start point -> calculate end point -> add subarray to return value -> set end point to new start point
    // Start can use this as-is, end will need special handling

    // Iteration through all but the last section
    for (let i: number = 0; i < numSections - 1; i++) {

        // If a given section doesn't end at a specific point, we need to interpolate between the two points surrounding the division
        if (zPoints.indexOf((i + 1) * global.stickout) === -1) {
            // Find the first z element that doesn't fall within the section we're looking at
            let firstIndexInNext = zPoints.findIndex((element) => element > ((i+1) * global.stickout))
            
            // Length of section is zPoints[fIIN] - zPoints[fIIN - 1]
            // Position of division in section is ((i+1) * stickout) - zPoints[fIIN - 1]
            // Decimal portion of index is second divided by first
            endIndex = firstIndexInNext - 1 + (((i+1) * global.stickout) - zPoints[firstIndexInNext - 1]) / (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1])
            
            // Use this decimal portion to derive x-z end point
            endPoint[0] = xPoints[firstIndexInNext - 1] + (endIndex % 1) * (xPoints[firstIndexInNext] - xPoints[firstIndexInNext - 1])
            endPoint[1] = zPoints[firstIndexInNext - 1] + (endIndex % 1) * (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1])
        }
        // Otherwise, we can use this index to set the end point
        else {
            endIndex = zPoints.indexOf((i + 1) * global.stickout)
            endPoint[0] = xPoints[endIndex]
            endPoint[1] = zPoints[endIndex]
        }

        // If start index is a decimal, we need to manually include the startPoint
        if (startIndex % 1) {
            includedPoints.push(new DimensionPoint(startPoint[0], startPoint[1] - (i * global.stickout)))
        }
        organizedPoints
        .slice(Math.ceil(startIndex), Math.floor(endIndex) + 1)
        .forEach((point) => {
            includedPoints.push(new DimensionPoint(point.x, point.z - (i * global.stickout)))
        })
        // Similarly, decimal end index means we need to include endPoint
        if (endIndex % 1) {
            includedPoints.push(new DimensionPoint(endPoint[0], endPoint[1] - (i * global.stickout)))
        }
        
        // Push a new section containing these points to our section array, shift end index/point to start, clear includedPoints
        sections.push(new Section(includedPoints))
        startIndex = endIndex
        startPoint[0] = endPoint[0]
        startPoint[1] = endPoint[1]
        includedPoints = []
    }
		
    endIndex = organizedPoints.length - 1
    // Final iteration, this will run from the start point to the final element in the provided points
    if (startIndex % 1) {
        includedPoints.push(new DimensionPoint(startPoint[0], startPoint[1] - ((numSections - 1) * global.stickout)))
    }
    organizedPoints
        .slice(Math.ceil(startIndex), Math.floor(endIndex) + 1)
        .forEach((point) => {
            includedPoints.push(new DimensionPoint(point.x, point.z - ((numSections - 1) * global.stickout)))
        })
    sections.push(new Section(includedPoints))

    return sections
}

/**
 * Generates Omniturn G code for machining of a specified tapered mandrel.
 *
 * @param {number} stockDiameter The diameter of the rod stock to be machined.
 * @param {Array<number>} diameterPoints Diameter measurments for the mandrel, either in increasing order at a spacing of 0.25" or with locations specified in the next parameter.
 * @param {Array<number>=} optPointLocations Locations of the points given in diameterPoints.
 * @return G code to produce the specified mandrel, or an error if provided data cannot be used to machine an mandrel.
 * @customfunction
 */
function genCode(stockDiameter, diameterList, optLocationList): string {
    // Storage for processed point data
    var diameterPoints: number[]
    var locationPoints: number[]

    // Local storage of debugging info - items ignored
    var numDiametersRemoved: number = 0
    var numPointsRemoved: number = -1

    // Stock diameter
    // TODO: Check that stock diameter is a number
    
    // Diameter points
    // Reorganize into 1D array
    diameterList = [].concat(...diameterList)
    // Filter out empty or non-numeric cells.  Number testing from here: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
    let filteredDiameterList: number[] = diameterList.filter((element) => element !== "" && !isNaN(element) && !isNaN(parseFloat(element)))
    numDiametersRemoved = diameterList.length - filteredDiameterList.length
    var diameterPoints: number[] = filteredDiameterList
    diameterPoints.forEach((diameter) => diameter = +diameter)

    // Overloaded function that can run with or without optPointLocations, assuming a spacing of 0.250" if not provided
    if (optLocationList === undefined) {
        locationPoints = []
        for (let i = 0; i < diameterPoints.length; i++) {
            locationPoints.push(i * 0.25)
        }
    }
    // Otherwise, confirm that two arrays are of matching lengths and throw an error if not
    // Then, sort by Z
    else {
        // Reorganize into 1D array
        optLocationList = [].concat(...optLocationList)
        // Filter out empty or non-numeric cells.  Number testing from here: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
        let filteredLocationList = optLocationList.filter((element) => element !== "" && !isNaN(element) && !isNaN(parseFloat(element)))
        numPointsRemoved = optLocationList.length - filteredLocationList.length
        locationPoints = filteredLocationList
        // Ensure that values are formatted as numbers
        locationPoints.forEach((location) => location = +location)

        // Ensure that equal numbers of points are provided
        if (locationPoints.length != diameterPoints.length) {
            return "Diameters and locations contain unqual numbers of valid data points."
        }

        // Sort by z value (algorithm from: https://stackoverflow.com/questions/11499268/sort-two-arrays-the-same-way)
        var tempObjects: DimensionPoint[] = []
        for (let i = 0; i < locationPoints.length; i++) {
            tempObjects.push(new DimensionPoint(diameterPoints[i], locationPoints[i]))
        }
        tempObjects.sort(function(a, b) {
            return ((a.z < b.z) ? -1 : ((a.z == b.z) ? 0 : 1))
        })
        for (let i = 0; i < tempObjects.length; i++) {
            diameterPoints[i] = tempObjects[i].x
            locationPoints[i] = tempObjects[i].z
        }
    }

    // Ensure that points are organized by increasing diameter over full length
    if (diameterPoints[0] > diameterPoints[diameterPoints.length - 1]) {
        diameterPoints.reverse()
        
        let taperLength = Math.max(...locationPoints)
        locationPoints.forEach(point => {
            -point + taperLength
        })
    }

    // Dividing points into sections
    var sections: Section[] = interpolatePoints(diameterPoints, locationPoints)

    // Code generation
    
    var codeText = ""
    // Print note if any lines were skipped
    if (numDiametersRemoved > 0 || numPointsRemoved > 0) {
        if (numDiametersRemoved == numPointsRemoved) {
            codeText += `(NOTE - ${numDiametersRemoved} non-numeric or empty data pair${(numDiametersRemoved > 1) ? "s" : ""} ignored.)\n`
        }
        // This will only happen if diameter positions were provided and removed
        else {
            if (numDiametersRemoved > 0) {
                codeText += `(NOTE - ${numDiametersRemoved} non-numeric or empty diameter${(numDiametersRemoved > 1) ? "s" : ""} ignored.)\n`
            }
            if (numPointsRemoved > 0) {
                codeText += `(NOTE - ${numPointsRemoved} non-numeric or empty point location${(numPointsRemoved > 1) ? "s" : ""} ignored.)\n`
            }
        }
    }
    // Description and comments
    codeText += "(OMalley Brass)\n"
    // Description?
    codeText += `(${global.stickout} inch part stickout)\n`
    codeText += `(${stockDiameter} inch diameter stock)\n`
    codeText += "(T1 OD Cutter)\n"
    codeText += "(Code generation by Jeremy Peplinski)\n"
    let date = new Date()
    codeText += `(Executed ${date.getMonth() + 1}.${date.getDate()}.${date.getFullYear()})\n`

    
    // Setup
    codeText += `G72G90G97G95F${global.feed}\n`
    codeText += "T1\n"

    // Then generate code for each section, subroutine ID will be (index + 1) * 100
    try {
        for(let i = 0; i < sections.length; i++) {
            codeText += "(Section " + (i + 1) + ")\n"
            codeText += sectionCycle(stockDiameter, sections[i], (i + 1) * 100)
        }
    } catch (err) {
        return err.message
    }

    // Program stop
    codeText += "M30\n"
    
    return codeText
}

/** 
 * Testing function for use within Google Apps Script editor
 */
function testGenCode() {
    let stockDiameter = 0.5
    let diameterPoints = [
        0.335,
        0.340,
        0.345,
        0.348,
        0.350,
        0.353,
        0.355,
        0.360,
        0.366
    ]
    let locations = [
        0.00,
        0.25,
        0.50,
        0.75,
        1.00,
        1.25,
        1.50,
        1.75,
        2.00
    ]
    genCode(stockDiameter, diameterPoints, locations)
}