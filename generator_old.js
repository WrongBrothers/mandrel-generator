/*
Necessary components:
CORE 
- Generate rapid positon (G00)
- Generate linear interpolation (G01)
- Generate box cut cycle (G74)
- Generate contour cut cycle (G75)
- Generate M code (Mxx)
BASE OPERATIONS
- Generate roughing (cylindrical) pass
- Generate contour pass
LARGER OPERATIONS
- Roughing process
- Final shaping process
- Full 1" cycle

Top layer will take a set of positions and diameters
*/

// CONSTANTS
// Cut depths
const maxRoughingDepth = 0.040;
const minFinishDepth = 0.010;

// Spacing for safety
const xSafeOffset = 0.01;
const zSafeOffset = 0.1;
const zCutPullback = 0.01;

// Feed rates
const zFeed = 0.002;

// Part stickout
const stickout = 1.0;

// Code accuracy
const decimals = 3

// GLOBALS
var lastGCode = "None";

function rapidPosition(x, y, z, comment) {
    let code = "";

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (lastGCode != "00") {
        code += "G00 ";
    }

    // Check each variable to see if it's given
    if (typeof x !== 'undefined') {
        code += "X" + x;
    }
    if (typeof y !== 'undefined') {
        code += "Y" + y;
    }
    if (typeof z !== 'undefined') {
        code += "Z" + z;
    }
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")";
    }

    // Close line of code
    code += "\n";

    // Set last G code used
    lastGCode = "00";

    return code;
}

function linearInterpolation(x, y, z, feed, comment) {
    let code = "";

    // Check if the last code used was this one
    // If so, we don't need to print the code
    if (lastGCode != "01") {
        code += "G01 ";
    }

    // Check each variable to see if it's given
    if (typeof x !== 'undefined') {
        code += "X" + x;
    }
    if (typeof y !== 'undefined') {
        code += "Y" + y;
    }
    if (typeof z !== 'undefined') {
        code += "Z" + z;
    }
    if (typeof feed !== 'undefined') {
        code += "F" + feed;
    }
    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")";
    }

    // Close line of code
    code += ";\n";

    // Set last G code used
    lastGCode = "01";

    return code;
}

function boxCycle(startX, startZ, endX, endZ, finishBufferRadius, feed, comment) {
    // Set initial position with rapid positioning
    let code = rapidPosition(startX, undefined, startZ);

    // Set up 
    code += "G74";
    code += "X" + endX;
    code += "X" + endZ;
    code += "I" + (maxRoughingDepth / 2);
    code += "U" + finishBufferRadius;
    code += "F" + feed;

    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")";
    }
    
    // Close line of code
    code += "\n";

    // Reset last used function for safety
    lastGCode = "None";

    return code;
}

function contourCycle(startX, startZ, points, subroutineID, finishBufferRadius, feed, comment) {
    // Set initial position with rapid positioning
    let code = rapidPosition(startX, undefined, startZ);

    // Set up 
    code += "G75";
    code += "I" + (maxRoughingDepth / 2);
    code += "U" + finishBufferRadius;
    code += "F" + feed;
    code += "P" + subroutineID;

    if (typeof comment !== 'undefined') {
        code += "(" + comment + ")";
    }
    
    // Close line of code
    code += "\n";

    // Reset last used function for safety
    lastGCode = "None";

    code += taperSubroutine(subroutineID, points);

    return code;
}

function taperSubroutine(id, points) {
    let code = "}" + id + "\n";

    points.foreach(point => {
        code += "X" + point[0] + "Z" + point[1] + "\n";
    })

    code += "M99\n"

    return code;
}

function mCode(code) {
    return "M" + code + "\n";
}

function cylindricalPass(diameter, startZ, endZ){
    let code = "";
    // Assume that cutter is homed to Z=0.1 for this, will return there at end of function
    code += rapidPosition(undefined, undefined, startZ + zSafeOffset);
    // G00Z.1;
    code += rapidPosition(diameter + xCutPullback);
    // G00X.44;
    code += linearInterpolation(diameter, undefined, undefined, zFeed);
    // G01X0.432F.002;
    code += linearInterpolation(undefined, undefined, endZ, zFeed);
    // G01Z-1.0;
    code += rapidPosition(diameter + xCutPullback, undefined, endZ + zCutPullback);
    // G00X.440Z-0.99;
    code += rapidPosition(undefined, undefined, startZ + zSafeOffset);
    // G00Z.1;
}

function contourPass(points) {

}

// Deprecated, going to use G75 for this process to avoid edge cases
function roughingCycle(initDiameter, finalDiameter, startZ, endZ) {
    // We need two points to define this with G74, one is (initD + safety, startZ + safety), the other is (finalD, endZ)
    // Start by moving to init position
    // let code = contourCycle(initDiameter + xSafeOffset, undefined, startZ + zSafeOffset);
}

function taperCycle(safeDiameter, points, feed) {
    // Set up easy access to the first point
    let startX = points[0][0];
    let startZ = points[0][1];
    // Jog to starting position from previous spot
    let code = rapidPosition(safeDiameter + xSafeOffset, undefined, undefined);
    code += rapidPosition(undefined, undefined, startZ + zSafeOffset);
    code += rapidPosition(startX + xSafeOffset);
    // Set up starting point
    code += linearInterpolation(startX, undefined, undefined, feed);
    code += linearInterpolation(undefined, undefined, startZ, feed);
    // Run path
    points.foreach(point => {
        code += linearInterpolation(point[0], undefined, point[1], feed);
    })
    return code;
}

function sectionCycle(startDiameter, points, subroutineID, pullLength) {
    // Confirm that points in section will be accurately cut into material
    let diameters = points.map(function(point) { return point[1]; });
    let maxDiameter = Math.max(...diameters);
    if (maxDiameter > startDiameter) {
        throw new RangeError("Provided taper includes diameter(s) exceeding provided start diameter, taper will not be accurate!");
    }

    // Set pullLength to stickout if undefined
    if (typeof pullLength !== 'undefined') {
        pullLength = stickout;
    }

    let code = "";
    // Set safe starting point
    code += rapidPosition(startDiameter + xSafeOffset, undefined, zSafeOffset);
    // Begin running spindle and set feed rate
    code += "M03S1500\n";
    code += "G95F0.002\n"
    // Run G75 roughing cycle
    code += contourCycle(startDiameter + xSafeOffset, zSafeOffset, points, subroutineID, maxRoughingDepth / 4, zFeed);
    // Run finishing pass
    code += taperCycle(maxDiameter, points, zFeed);
    // Return cutter to safe position
    code += rapidPosition(startDiameter + xSafeOffset);
    code += rapidPosition(undefined, undefined, zSafeOffset);
    // Stop spindle
    code += "M05\n"
    // Set cutter to zeroing position (between largest taper diameter and stock diameter, we'll say largest taper diameter + safe clearance)
    code += rapidPosition(maxDiameter + xSafeOffset, undefined, stickout - pullLength);
    // Optional stop
    code += "M01\n"

    return code;
}

// Returns a 3d array, with each top-level element being a set of 2D points for a specific machining section
function interpolatePoints(xPoints, zPoints) {
    // Determine how many sections we need to create, with the final section being the one to potentially be shorter than sectionLength
    let fullLength = Math.max(...zPoints);
    var numSections = Math.ceil(fullLength / stickout);

    var startPoint = [xPoints[0], zPoints[0]];
    var startIndex = 0;
    var endPoint = [0, 0];
    var endIndex = 0;
    
    // This variable collects the separate xPoints and zPoints arrays into a single array of individual x-z points
    var organizedPoints = [];
    for (let i = 0; i < xPoints.length; i++) {
        organizedPoints.push([xPoints[i], zPoints[i]]);
    }

    // This will collect the lists of points broken into sections
    var returnArray = [];
    // Storage for points in each section
    var includedPoints = [];

    // We need to iterate through each section and collect the data points included in it (potentially interpolating start/end points)
    // Base cases are the first and last elements:
    // First element can assume that the start point is our first point, only needs to calculate end point
    // Last element can assume that the end point is our last point, reuse previous end point as start
    
    // General cycle will be: Grab start point -> calculate end point -> add subarray to return value -> set end point to new start point
    // Start can use this as-is, end will need special handling

    // Iteration through all but the last section
    for (let i = 0; i < numSections - 1; i++) {

        // If a given section doesn't end at a specific point, we need to interpolate between the two points surrounding the division
        if (zPoints.indexOf((i + 1) * stickout) == -1) {
            // Find the first z element that doesn't fall within the section we're looking at
            let firstIndexInNext = zPoints.findIndex((element) => element > ((i+1) * stickout));
            
            // Length of section is zPoints[fIIN] - zPoints[fIIN - 1]
            // Position of division in section is ((i+1) * stickout) - zPoints[fIIN - 1]
            // Decimal portion of index is second divided by first
            endIndex = firstIndexInNext - 1 + (((i+1) * stickout) - zPoints[firstIndexInNext - 1]) / (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1]);
            
            // Use this decimal portion to derive x-z end point
            endPoint[0] = xPoints[firstIndexInNext - 1] + (endIndex % 1) * (xPoints[firstIndexInNext] - xPoints[firstIndexInNext - 1]);
            endPoint[1] = zPoints[firstIndexInNext - 1] + (endIndex % 1) * (zPoints[firstIndexInNext] - zPoints[firstIndexInNext - 1]);
        }
        // Otherwise, we can use this index to set the end point
        else {
            endIndex = zPoints.indexOf((i + 1) * stickout);
            endPoint[0] = xPoints[endIndex];
            endPoint[1] = zPoints[endIndex];
        }

        // If start index is a decimal, we need to manually include the startPoint
        if (startIndex % 1) {
            includedPoints.push([startPoint[0], startPoint[1]]);
        }
        organizedPoints.slice(Math.ceil(startIndex), Math.floor(endIndex) + 1).forEach((point) => includedPoints.push([point[0], point[1]]));
        // Similarly, decimal end index means we need to include endPoint
        if (endIndex % 1) {
            includedPoints.push([endPoint[0], endPoint[1]]);
        }
        
        // Push this collection to our return array, shift end index/point to start, clear includedPoints
        returnArray.push(includedPoints);
        startIndex = endIndex;
        startPoint[0] = endPoint[0];
        startPoint[1] = endPoint[1];
        includedPoints = [];
    }
		endIndex = organizedPoints.length - 1;
    // Final iteration, this will run from the start point to the final element in the provided points
    if (startIndex % 1) {
        includedPoints.push([startPoint[0], startPoint[1]]);
    }
    organizedPoints.slice(Math.ceil(startIndex), Math.floor(endIndex) + 1).forEach((point) => includedPoints.push([point[0], point[1]]));
    returnArray.push(includedPoints);

    return returnArray;
}

function genCode(stockDiameter, diameterPoints, optPointLocations) {
    // Overloaded function that can run with or without optPointLocations, assuming a spacing of 0.250" if not provided
    if (optPointLocations === undefined) {
        optPointLocations = [];
        for (let i = 0; i < diameterPoints.length; i++) {
            optPointLocations.push(i * 0.25);
        }
    }
    // Otherwise, confirm that two arrays are of matching lengths and throw an error if not
    // Then, sort by Z and offset so start point is at z=0
    else {
        if (optPointLocations.length != diameterPoints.length) {
            return "Diameters and locations contain unqual numbers of data points.";
        }
        // Sort by z value (algorithm from: https://stackoverflow.com/questions/11499268/sort-two-arrays-the-same-way)
        var tempObjects = [];
        for (let i = 0; i < optPointLocations.length; i++) {
            tempObjects.push({'x': diameterPoints[i], 'z': optPointLocations[i]});
        }
        tempObjects.sort(function(a, b) {
            return ((a.z < b.z) ? -1 : ((a.z == b.z) ? 0 : 1));
        });
        for (let i = 0; i < tempObjects.length; i++) {
            diameterPoints[i] = tempObjects[i].x;
            optPointLocations[i] = tempObjects[i].z;
        }
    }
    // Now we need to break these points up into sections defined by our part stickout, linearly interpolating between points when divisions don't fall accurately on them.
    sections = interpolatePoints(diameterPoints, optPointLocations);
    // Each section needs to use a coordinate system where the first point is at z=0, stickout will be z of last element
    sections.forEach((section) => {
        let offset = section[0][1];
        section.forEach((point) => point[1] = point[1] - offset);
    });
    // Then generate code for each section, subroutine ID will be (index + 1) * 100, pull needs to be max Z of next section (except last, which we'll set at stickout)
    codeText = "";
    for(let i = 0; i < sections.length; i++) {
        codeText += "(Section " + (i + 1) + ")\n";
        if (i != sections.length - 1) {
            // pull length defined by next section
            codeText += sectionCycle(stockDiameter, sections[i], (i + 1) * 100, sections[i + 1][sections[i+1].length - 1][1]);
        }
        else {
            codeText += sectionCycle(stockDiameter, sections[i], (i + 1) * 100, stickout);
        }
    }

    // Program stop
    codeText += "M30\n";
    
    return codeText;
}