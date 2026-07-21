/**
 * FlowCompiler
 * 
 * Converts a visual flow graph (nodes + connections + variables) into a
 * linear, executable instruction list that the Runtime can step through.
 * Also supports decompiling back into the visual representation.
 *
 * Compiled format (an object):
 * {
 *   steps: [
 *     { id, type, data, next: <stepId|null>, options?: [{id, value, next}] }
 *   ],
 *   variables: { varName: null, ... },
 *   entrypoint: <stepId>
 * }
 */
class FlowCompiler {

    /**
     * compile — Convert visual graph → executable code
     * @param {Array} nodesArray  – [{id, type, x, y, data:{...}}]
     * @param {Array} connections – [{source, sourcePort, target}]
     * @param {Array} variableNames – ['var1','var2']
     * @returns {Object} compiled flow
     */
    static compile(nodesArray, connections, variableNames) {
        // Build a lookup: nodeId → node
        const nodeMap = {};
        nodesArray.forEach(n => { nodeMap[n.id] = n; });

        // Build an adjacency lookup: sourceId:portId → targetId
        const edgeMap = {};
        connections.forEach(c => {
            edgeMap[`${c.source}:${c.sourcePort}`] = c.target;
        });

        // Find the start node
        const startNode = nodesArray.find(n => n.type === 'start');
        if (!startNode) {
            throw new Error('No start node found. Add a Start node to the flow.');
        }

        // Walk the graph from the start node using BFS to build the steps list
        const steps = [];
        const visited = new Set();
        const queue = [startNode.id];

        while (queue.length > 0) {
            const nodeId = queue.shift();
            if (visited.has(nodeId)) continue;
            visited.add(nodeId);

            const node = nodeMap[nodeId];
            if (!node) continue;

            const step = {
                id: node.id,
                type: node.type,
                data: { ...node.data },
                next: null
            };

            if (node.type === 'getOption') {
                // For getOption, each option has its own output port
                const options = (node.data.options || []).map(opt => {
                    const targetId = edgeMap[`${node.id}:${opt.id}`] || null;
                    if (targetId && !visited.has(targetId)) queue.push(targetId);
                    return {
                        id: opt.id,
                        value: opt.value,
                        next: targetId
                    };
                });
                step.options = options;
            } else {
                // Standard single-output node
                const targetId = edgeMap[`${node.id}:out`] || null;
                step.next = targetId;
                if (targetId && !visited.has(targetId)) queue.push(targetId);
            }

            steps.push(step);
        }

        // Build variables map (all initialized to null)
        const variables = {};
        variableNames.forEach(v => { variables[v] = null; });

        return {
            entrypoint: startNode.id,
            steps,
            variables
        };
    }

    /**
     * decompile — Convert compiled code → visual graph arrays
     * @param {Object} compiled
     * @returns {{ nodes: Array, connections: Array, variables: Array }}
     */
    static decompile(compiled) {
        const nodes = [];
        const connections = [];

        compiled.steps.forEach(step => {
            const nodeData = { ...step.data };

            nodes.push({
                id: step.id,
                type: step.type,
                x: step.data._x || 100,
                y: step.data._y || 100,
                data: nodeData
            });

            if (step.type === 'getOption' && step.options) {
                step.options.forEach(opt => {
                    if (opt.next) {
                        connections.push({
                            source: step.id,
                            sourcePort: opt.id,
                            target: opt.next
                        });
                    }
                });
            } else if (step.next) {
                connections.push({
                    source: step.id,
                    sourcePort: 'out',
                    target: step.next
                });
            }
        });

        const variables = Object.keys(compiled.variables || {});

        return { nodes, connections, variables };
    }

    /**
     * Utility: count total executable steps (excluding start)
     */
    static countSteps(compiled) {
        return compiled.steps.filter(s => s.type !== 'start').length;
    }
}

// Export for browser usage
window.FlowCompiler = FlowCompiler;
