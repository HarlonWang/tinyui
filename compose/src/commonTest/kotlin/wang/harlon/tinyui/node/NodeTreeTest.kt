package wang.harlon.tinyui.node

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.sp
import wang.harlon.tinyui.components.registerBuiltins
import wang.harlon.tinyui.schema.ComponentRegistry
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NodeTreeTest {
    private val problems = mutableListOf<PatchProblem>()
    private val tree = NodeTree(ComponentRegistry().registerBuiltins()) { problems += it }

    private fun ids(node: UiNode) = node.children.map { it.id }

    @Test
    fun mountsTheCounterTree() {
        tree.apply("""[["c",1,"Text"],["p",1,"text","Count: 0"],["c",2,"Button"],["p",2,"text","+1"],["p",2,"onClick",true],["c",3,"Column"],["i",3,1,0],["i",3,2,1],["i",0,3,0]]""")
        assertEquals(listOf(3), ids(tree.root))
        assertEquals(listOf(1, 2), ids(tree.node(3)!!))
        assertEquals("Count: 0", tree.node(1)!!.props["text"])
        assertEquals(true, tree.node(2)!!.events["onClick"])
        assertTrue(problems.isEmpty(), problems.toString())
    }

    @Test
    fun convertsPropsOnWriteAndRestoresDefaultsOnNull() {
        tree.apply("""[["c",1,"Text"],["p",1,"color","#FF0000"],["p",1,"fontSize",18],["i",0,1,0]]""")
        val node = tree.node(1)!!
        assertEquals(Color(0xFFFF0000), node.props["color"])
        assertEquals(18.sp, node.props["fontSize"])
        tree.apply("""[["p",1,"color",null]]""")
        assertEquals(Color.Unspecified, node.props["color"])
        assertTrue(problems.isEmpty(), problems.toString())
    }

    @Test
    fun moveRemoveAndCommandsFollowTheProtocol() {
        tree.apply("""[["c",1,"Column"],["c",2,"Text"],["c",3,"Text"],["c",4,"Text"],["i",1,2,0],["i",1,3,1],["i",1,4,2],["i",0,1,0]]""")
        tree.apply("""[["m",1,4,0]]""")
        assertEquals(listOf(4, 2, 3), ids(tree.node(1)!!))
        tree.apply("""[["r",2]]""")
        assertEquals(listOf(4, 3), ids(tree.node(1)!!))
        assertNull(tree.node(2))
        tree.apply("""[["r",1]]""")
        assertEquals(1, tree.size, "removing a subtree forgets every descendant")
        assertTrue(problems.isEmpty(), problems.toString())
    }

    @Test
    fun rootIsOnlyEverAParentAndCyclesAreRejected() {
        tree.apply("""[["c",1,"Column"],["c",2,"Column"],["i",1,2,0],["i",0,1,0]]""")
        tree.apply("""[["r",0],["i",2,0,0],["i",2,1,0],["i",1,1,0],["p",0,"text","x"],["m",1,2,7]]""")
        assertEquals(listOf("the root container is not a child", "the root container is not a child", "i: node already has a parent", "i: node already has a parent", "the root container is not a child", "index 7 out of [0, 0], clamped"),
            problems.map { it.reason })
        assertEquals(listOf(1), ids(tree.root))
        assertEquals(listOf(2), ids(tree.node(1)!!))
        problems.clear()
        tree.apply("""[["m",1,2]]""")
        assertEquals("missing index", problems.single().reason)
        assertEquals(listOf(2), ids(tree.node(1)!!), "a rejected move leaves the list untouched")
    }

    @Test
    fun badOpsAreSkippedAndReported() {
        tree.apply("""[["c",1,"Text"],["p",1,"nope","x"],["p",1,"fontSize","big"],["p",1,"onTap",true],["p",99,"text","x"],["c",2,"pp.Unknown"],["i",0,2,7],["x",1,"focus",{}],["i",0,1,0]]""")
        val expected = listOf("prop not in schema", "cannot convert", "event not in schema", "unknown node 99", "unknown component type", "index 7 out of", "command not in schema")
        assertEquals(expected.size, problems.size, problems.toString())
        for ((reason, prefix) in problems.map { it.reason }.zip(expected)) assertTrue(reason.startsWith(prefix), "$reason should start with $prefix")
        assertEquals(ComponentRegistry.PLACEHOLDER, tree.node(2)!!.type)
        assertEquals(listOf(1, 2), ids(tree.root), "the clamped insert (7 → 0 on an empty root) still lands")
        tree.apply("not json")
        assertEquals("message is not a JSON array", problems.last().reason.substringBefore(" ("))
    }
}
