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
- Divide into sections based on pull length (first section becomes the short one)
- Generate beginning code:
    - Basic overall settings
- Generate cycle codes:
    - Set zeroing location
    - Pause program
    - Back off to safe location
    - Start spindle
    - Roughing and finishing passes (pass stickout amount into these to profile correctly)
    - Move to safe location
    - Stop spindle
- Cleanup:
    - End of program stop
    - ?
*/

class MovePoint {
    x: number | undefined
    y: number | undefined
    z: number | undefined
    
    constructor (x?: number, y?: number, z?: number) {
        this.x = x
        this.y = y
        this.z = z
    }
}

class DimensionPoint {
    x: number
    z: number

    constructor (x: number, z: number) {
        this.x = x
        this.z = z
    }
}

class Section {
    points: DimensionPoint[]
    length: number

    constructor (points: DimensionPoint[]) {
        this.points = points
        this.length = Math.max(...(points.map( (point) => point.z)))
    }

    getOffsetPoint(index: number): DimensionPoint {
        return new DimensionPoint(this.points[index].x, this.points[index].z - this.length)
    }
}


// CONSTANTS
// Cut depths
const maxRoughingDepth: number = 0.040
const minFinishDepth: number = 0.010

// Spacing for safety
const xSafeOffset: number = 0.01
const zSafeOffset: number = 0.1
const zCutPullback: number = 0.01

// Feed rates
const fineFeed: number = 0.002

// Part stickout
const stickout: number = 1.0

// Code accuracy
const decimals: number = 4

// GLOBALS
var lastGCode: string = "None"
var lastFeed: number | undefined = -1

function rapidPosition(x?: number, y?: number, z?: number, comment?: string): string {
    let code: string = ""

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (lastGCode != "00") {
        code += "G00"
    }

    // Check each variable to see if it's given
    if (typeof x !== 'undefined') {
        code += "X" + (+x.toFixed(decimals))
    }
    if (typeof y !== 'undefined') {
        code += "Y" + (+y.toFixed(decimals))
    }
    if (typeof z !== 'undefined') {
        code += "Z" + (+z.toFixed(decimals))
    }
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }

    // Close line of code
    code += "\n"

    // Set last G code used and reset feed rate
    lastGCode = "00"
    lastFeed = -1

    return code
}

function linearInterpolation(x?: number, y?: number, z?: number, feed?: number, comment?: string): string {
    let code = ""

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (lastGCode != "01") {
        code += "G01"
    }

    // Check each variable to see if it's given
    if (typeof x !== 'undefined') {
        code += "X" + (+x.toFixed(decimals))
    }
    if (typeof y !== 'undefined') {
        code += "Y" + (+y.toFixed(decimals))
    }
    if (typeof z !== 'undefined') {
        code += "Z" + (+z.toFixed(decimals))
    }
    if (typeof feed !== 'undefined' && feed != lastFeed) {
        code += "F" + (+feed.toFixed(decimals))
    }
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }

    // Close line of code
    code += "\n"

    // Set last G code used and feed rate
    lastGCode = "01"
    lastFeed = feed

    return code
}

function boxCycle(startX: number, startZ: number, endX: number, endZ: number, finishBufferRadius: number, feed: number, comment?: string): string {
    // Set initial position with rapid positioning
    let code: string = rapidPosition(startX, undefined, startZ)

    // Set up 
    code += "G74"
    code += "X" + (+endX.toFixed(decimals))
    code += "X" + (+endZ.toFixed(decimals))
    code += "I" + (+(maxRoughingDepth / 2).toFixed(decimals))
    code += "U" + (+finishBufferRadius.toFixed(decimals))
    code += "F" + (+feed.toFixed(decimals))

    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }
    
    // Close line of code
    code += "\n"

    // Reset last used function for safety
    lastGCode = "None"

    return code
}

function contourCycle(startX: number, startZ: number, points: number[][], subroutineID: number, finishBufferRadius: number, feed: number, comment?: string): string {
    // Set initial position with rapid positioning
    let code: string = linearInterpolation(startX, undefined, startZ, feed)

    // Set up 
    code += "G75"
    code += "I" + (+(maxRoughingDepth / 2).toFixed(decimals))
    code += "U" + (+finishBufferRadius.toFixed(decimals))
    code += "F" + (+feed.toFixed(decimals))
    code += "P" + (+subroutineID.toFixed(decimals))

    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")"
    }
    
    // Close line of code
    code += "\n"

    // Reset last used function for safety
    lastGCode = "None"

    code += taperSubroutine(subroutineID, points)

    return code
}

function taperSubroutine(id: number, points: number[][]): string {
    // Removing subroutine formatting (added in G3?), using RF to close
    // let code = "}" + id + "\n"
    let code: string = ""

    points.forEach(point => {
        code += "X" + (+point[0].toFixed(decimals)) + "Z" + (+point[1].toFixed(decimals)) + "\n"
    })

    code += "RF"
    // code += "M99\n"
    
    return code
}

function taperCycle(safeDiameter: number, points: number[][], feed: number): string {
    // Set up easy access to the first point
    let startX: number = points[0][0]
    let startZ: number = points[0][1]
    // Jog to starting position from previous spot
    let code: string = linearInterpolation(safeDiameter + xSafeOffset, undefined, undefined)
    code += rapidPosition(undefined, undefined, startZ + zSafeOffset)
    code += rapidPosition(startX + xSafeOffset)
    // Set up starting point
    code += linearInterpolation(startX, undefined, undefined, feed)
    code += linearInterpolation(undefined, undefined, startZ, feed)
    // Run path
    points.forEach(point => {
        code += linearInterpolation(point[0], undefined, point[1], feed)
    })
    return code
}

function sectionCycle(startDiameter: number, points: number[][], subroutineID: number, pullLength?: number): string {
    // Confirm that points in section will be accurately cut into material
    let diameters: number[] = points.map(function(point) { return point[0] })
    let maxDiameter: number = Math.max(...diameters)
    if (maxDiameter > startDiameter) {
        throw new RangeError("Provided taper includes diameter(s) exceeding provided start diameter, taper will not be accurate!")
    }

    // Set pullLength to stickout if undefined
    if (typeof pullLength === 'undefined') {
        pullLength = stickout
    }
    // Redefine 0 point of z axis 

    let code = ""
    // Set safe starting point
    code += rapidPosition(startDiameter + xSafeOffset, undefined, zSafeOffset)
    // Begin running spindle and set feed rate
    code += "M03S1500\n"
    // code += "G95F0.002\n"
    // Run G75 roughing cycle
    code += contourCycle(startDiameter + xSafeOffset, zSafeOffset, points, subroutineID, maxRoughingDepth / 4, fineFeed)
    // Run finishing pass
    code += taperCycle(maxDiameter, points, fineFeed)
    // Return cutter to safe position
    code += linearInterpolation(startDiameter + xSafeOffset, undefined, undefined, fineFeed)
    code += rapidPosition(undefined, undefined, zSafeOffset)
    // Stop spindle
    code += "M05\n"
    // Set cutter to zeroing position (between largest taper diameter and stock diameter, we'll say largest taper diameter + safe clearance)
    code += linearInterpolation(maxDiameter + xSafeOffset, undefined, stickout - pullLength, fineFeed)
    // Optional stop
    code += "M01\n"

    return code
}

// Returns a 3d array, with each top-level element being a set of 2D points for a specific machining section
function interpolatePoints(xPoints: number[], zPoints: number[]): number[][][] {
    // Determine how many sections we need to create, with the final section being the one to potentially be shorter than sectionLength
    let fullLength: number = Math.max(...zPoints)
    var numSections: number = Math.ceil(fullLength / stickout)

    var startPoint: number[] = [xPoints[0], zPoints[0]]
    var startIndex: number = 0
    var endPoint: number[] = [0, 0]
    var endIndex: number = 0
    
    // This variable collects the separate xPoints and zPoints arrays into a single array of individual x-z points
    var organizedPoints: number[][] = []
    for (let i = 0; i < xPoints.length; i++) {
        organizedPoints.push([xPoints[i], zPoints[i]]);
    }

    // This will collect the lists of points broken into sections
    var returnArray: number[][][] = [];
    // Storage for points in each section
    var includedPoints: number[][] = [];

    // We need to iterate through each section and collect the data points included in it (potentially interpolating start/end points)
    // Base cases are the first and last elements:
    // First element can assume that the start point is our first point, only needs to calculate end point
    // Last element can assume that the end point is our last point, reuse previous end point as start
    
    // General cycle will be: Grab start point -> calculate end point -> add subarray to return value -> set end point to new start point
    // Start can use this as-is, end will need special handling

    // Iteration through all but the last section
    for (let i: number = 0; i < numSections - 1; i++) {

        // If a given section doesn't end at a specific point, we need to interpolate between the two points surrounding the division
        if (zPoints.indexOf((i + 1) * stickout) === -1) {
            // Find the first z element that doesn't fall within the section we're looking at
            let firstIndexInNext = zPoints.findIndex((element) => element > ((i+1) * stickout))
            
            // Length of section is zPoints[fIIN] - zPoints[fIIN - 1]
            // Position of division in section is ((i+1) * stickout) - zPoints[fIIN - 1]
            // Decimal portion of index is second divided by first
            endIndex = firstIndexInNext - 1 + (((i+1) * stickout) - zPoints[firstIndexInNext - 1]) / (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1])
            
            // Use this decimal portion to derive x-z end point
            endPoint[0] = xPoints[firstIndexInNext - 1] + (endIndex % 1) * (xPoints[firstIndexInNext] - xPoints[firstIndexInNext - 1])
            endPoint[1] = zPoints[firstIndexInNext - 1] + (endIndex % 1) * (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1])
        }
        // Otherwise, we can use this index to set the end point
        else {
            endIndex = zPoints.indexOf((i + 1) * stickout)
            endPoint[0] = xPoints[endIndex]
            endPoint[1] = zPoints[endIndex]
        }

        // If start index is a decimal, we need to manually include the startPoint
        if (startIndex % 1) {
            includedPoints.push([startPoint[0], startPoint[1]])
        }
        organizedPoints.slice(Math.ceil(startIndex), Math.floor(endIndex) + 1).forEach((point) => includedPoints.push([point[0], point[1]]))
        // Similarly, decimal end index means we need to include endPoint
        if (endIndex % 1) {
            includedPoints.push([endPoint[0], endPoint[1]])
        }
        
        // Push this collection to our return array, shift end index/point to start, clear includedPoints
        returnArray.push(includedPoints)
        startIndex = endIndex
        startPoint[0] = endPoint[0]
        startPoint[1] = endPoint[1]
        includedPoints = []
    }
		endIndex = organizedPoints.length - 1
    // Final iteration, this will run from the start point to the final element in the provided points
    if (startIndex % 1) {
        includedPoints.push([startPoint[0], startPoint[1]])
    }
    organizedPoints.slice(Math.ceil(startIndex), Math.floor(endIndex) + 1).forEach((point) => includedPoints.push([point[0], point[1]]))
    returnArray.push(includedPoints)

    return returnArray
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
function genCode(stockDiameter, diameterPoints, optPointLocations): string {
    // General setup and error checking

    // Local storage of debugging info - items ignored
    var numDiametersRemoved: number = 0
    var numPointsRemoved: number = -1

    // Stock diameter
    // TODO: Check that stock diameter is a number
    
    // Diameter points
    // Reorganize into 1D array
    diameterPoints = [].concat(...diameterPoints)
    // Filter out empty or non-numeric cells.  Number testing from here: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
    let filteredDiameterPoints = diameterPoints.filter((element) => element !== "" && !isNaN(element) && !isNaN(parseFloat(element)))
    numDiametersRemoved = diameterPoints.length - filteredDiameterPoints.length
    diameterPoints = filteredDiameterPoints
    diameterPoints.forEach((diameter) => diameter = +diameter)

    // Overloaded function that can run with or without optPointLocations, assuming a spacing of 0.250" if not provided
    if (optPointLocations === undefined) {
        optPointLocations = []
        for (let i = 0; i < diameterPoints.length; i++) {
            optPointLocations.push(i * 0.25)
        }
    }
    // Otherwise, confirm that two arrays are of matching lengths and throw an error if not
    // Then, sort by Z and offset so start point is at z=0
    else {
        // Reorganize into 1D array
        optPointLocations = [].concat(...optPointLocations)
        // Filter out empty or non-numeric cells.  Number testing from here: https://stackoverflow.com/questions/175739/how-can-i-check-if-a-string-is-a-valid-number
        let filteredPointLocations = optPointLocations.filter((element) => element !== "" && !isNaN(element) && !isNaN(parseFloat(element)))
        numPointsRemoved = optPointLocations.length - filteredPointLocations.length
        optPointLocations = filteredPointLocations
        // Ensure that values are formatted as numbers
        optPointLocations.forEach((location) => location = +location)

        // Ensure that equal numbers of points are provided
        if (optPointLocations.length != diameterPoints.length) {
            return "Diameters and locations contain unqual numbers of valid data points."
        }

        // Sort by z value (algorithm from: https://stackoverflow.com/questions/11499268/sort-two-arrays-the-same-way)
        var tempObjects: DimensionPoint[] = []
        for (let i = 0; i < optPointLocations.length; i++) {
            tempObjects.push(new DimensionPoint(diameterPoints[i], optPointLocations[i]))
        }
        tempObjects.sort(function(a, b) {
            return ((a.z < b.z) ? -1 : ((a.z == b.z) ? 0 : 1))
        })
        for (let i = 0; i < tempObjects.length; i++) {
            diameterPoints[i] = tempObjects[i].x
            optPointLocations[i] = tempObjects[i].z
        }
    }
    // Now we need to break these points up into sections defined by our part stickout, linearly interpolating between points when divisions don't fall accurately on them.
    var sections: number[][][] = interpolatePoints(diameterPoints, optPointLocations)
    // Each section needs to use a coordinate system where the first point is at z=0, stickout will be z of last element
    sections.forEach((section) => {
        let offset: number = section[0][1]
        section.forEach((point) => point[1] = point[1] - offset)
    })

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
    codeText += `(${stickout} inch part stickout)\n`
    codeText += `(${stockDiameter} inch diameter stock)\n`
    codeText += "(T1 OD Cutter)\n"
    codeText += "(Code generation by Jeremy Peplinski)\n"
    let date = new Date()
    codeText += `(Executed ${date.getMonth() + 1}.${date.getDate()}.${date.getFullYear()})\n`

    
    // Setup
    codeText += `G72G90G97G95F${fineFeed}\n`
    codeText += "T1\n"

    // Then generate code for each section, subroutine ID will be (index + 1) * 100, pull needs to be max Z of next section (except last, which we'll set at stickout)
    try {
        for(let i = 0; i < sections.length; i++) {
            codeText += "(Section " + (i + 1) + ")\n"
            if (i != sections.length - 1) {
                // pull length defined by next section
                codeText += sectionCycle(stockDiameter, sections[i], (i + 1) * 100, sections[i + 1][sections[i+1].length - 1][1])
            }
            else {
                codeText += sectionCycle(stockDiameter, sections[i], (i + 1) * 100, stickout)
            }
        }
    } catch (err) {
        return err.message
    }

    // Program stop
    codeText += "M30\n"
    
    return codeText
}