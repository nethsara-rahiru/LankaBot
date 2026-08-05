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

        // Find entry nodes
        const entryNodes = nodesArray.filter(n => n.type === 'start' || n.type === 'newFlow');
        if (entryNodes.length === 0) {
            throw new Error('No entry node found. Add a Start or New Flow node.');
        }

        const steps = [];
        const visited = new Set();
        const queue = entryNodes.map(n => n.id);

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
            } else if (node.type === 'if' || node.type === 'ifAI') {
                const trueTargetId = edgeMap[`${node.id}:true`] || null;
                const falseTargetId = edgeMap[`${node.id}:false`] || null;
                step.nextTrue = trueTargetId;
                step.nextFalse = falseTargetId;
                if (trueTargetId && !visited.has(trueTargetId)) queue.push(trueTargetId);
                if (falseTargetId && !visited.has(falseTargetId)) queue.push(falseTargetId);
            } else {
                // Standard single-output node
                let targetId = edgeMap[`${node.id}:out`] || null;

                // catalogSelector migration: old flows stored per-item port IDs instead of 'out'.
                // Fall back to the first connection from this node, regardless of port name.
                if (!targetId && node.type === 'catalogSelector') {
                    const fallback = connections.find(c => c.source === node.id);
                    if (fallback) targetId = fallback.target;
                }

                step.next = targetId;
                if (targetId && !visited.has(targetId)) queue.push(targetId);
            }

            steps.push(step);
        }

        // Build variables map (all initialized to null)
        const variables = {};
        variableNames.forEach(v => { variables[v] = null; });

        // Build entrypoints map
        const entrypoints = {};
        const defaultStart = entryNodes.find(n => n.type === 'start');
        
        entryNodes.forEach(n => {
            if (n.type === 'start') {
                entrypoints['default'] = { id: n.id, topic: 'default', description: 'Default greeting/start flow' };
            } else {
                const topic = n.data.topic || n.id;
                entrypoints[topic] = { id: n.id, topic: topic, description: n.data.description || '' };
            }
        });

        return {
            entrypoint: defaultStart ? defaultStart.id : entryNodes[0].id,
            entrypoints,
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
            } else if (step.type === 'if' || step.type === 'ifAI') {
                if (step.nextTrue) {
                    connections.push({ source: step.id, sourcePort: 'true', target: step.nextTrue });
                }
                if (step.nextFalse) {
                    connections.push({ source: step.id, sourcePort: 'false', target: step.nextFalse });
                }
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
