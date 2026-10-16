import com.zaoyan.domain.CountingRules;import com.fasterxml.jackson.databind.*;import com.fasterxml.jackson.databind.node.*;
public class CountingRulesCheck {
 static int passed=0;static ObjectMapper mapper=new ObjectMapper();
 static void good(String name,CountingRules r){r.validate(.25,.5,.75,.5);passed++;System.out.println("PASS "+name);}
 static void bad(String name,java.util.function.Consumer<ObjectNode> change){ObjectNode node=mapper.valueToTree(CountingRules.defaults());change.accept(node);try{CountingRules.parse(node.toString()).validate(.25,.5,.75,.5);throw new AssertionError("accepted "+name);}catch(IllegalArgumentException expected){passed++;System.out.println("PASS rejects "+name);}}
 public static void main(String[]args){good("defaults",CountingRules.defaults());good("legacy null",CountingRules.parse(null));good("JSON roundtrip",CountingRules.parse(CountingRules.defaults().json()));
 bad("too small ROI",n->n.put("roiX2",.05));bad("line outside ROI",n->n.put("roiX1",.3));bad("review threshold",n->n.put("reviewConfidence",.1));
 bad("missing nesting policy",n->n.putNull("nestingPolicy"));bad("unknown policy",n->n.put("nestingPolicy","ALL"));bad("frame range",n->n.put("stableFrames",0));
 bad("class collision",n->n.set("targetLabels",mapper.valueToTree(java.util.List.of("empty_tray"))));bad("uppercase class",n->n.set("targetLabels",mapper.valueToTree(java.util.List.of("Tray"))));
 bad("duplicate class",n->n.set("targetLabels",mapper.valueToTree(java.util.List.of("tray","tray"))));bad("empty target",n->n.set("targetLabels",mapper.createArrayNode()));
 bad("overlap meal",n->((ObjectNode)n.path("meals").get(1)).put("start","09:00"));bad("cross midnight",n->((ObjectNode)n.path("meals").get(2)).put("end","01:00"));
 bad("null meal slot",n->((ObjectNode)n.path("meals").get(0)).putNull("slot"));
 System.out.println("COUNTING_RULES_CHECK: "+passed+" passed; actual Java 21 + Jackson; no Spring or DB runtime");}
}
