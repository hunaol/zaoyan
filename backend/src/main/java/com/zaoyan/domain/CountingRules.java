package com.zaoyan.domain;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.LocalTime;
import java.util.*;

/** Versioned, immutable calibration contract shared with Python. Missing legacy JSON uses defaults. */
public record CountingRules(int schemaVersion, double roiX1, double roiY1, double roiX2, double roiY2,
    double confidence, double reviewConfidence, double deadzone, int stableFrames,
    double maxGapSeconds, double duplicateWindowSeconds, double duplicateDistance,
    String nestingPolicy, List<String> targetLabels, List<String> emptyLabels,
    List<MealWindow> meals) {
    private static final ObjectMapper JSON=new ObjectMapper();
    public record MealWindow(String slot,String start,String end){}
    public static CountingRules defaults(){return new CountingRules(1,0,0,1,1,.35,.65,.012,2,2.5,1.5,.08,
        "OUTER",List.of("tray","plate","lunchbox","mealbox","meal box","food box","bowl"),
        List.of("empty_tray","empty_box"),List.of(new MealWindow("BREAKFAST","06:00","10:00"),
        new MealWindow("LUNCH","10:00","16:00"),new MealWindow("DINNER","16:00","22:00")));}
    public static CountingRules parse(String value){
        if(value==null||value.isBlank())return defaults();
        try{return JSON.readValue(value,CountingRules.class);}catch(Exception e){throw new IllegalArgumentException("计数规则损坏，请重新保存设置");}
    }
    public String json(){try{return JSON.writeValueAsString(this);}catch(Exception e){throw new IllegalArgumentException("计数规则无法保存");}}
    public void validate(double x1,double y1,double x2,double y2){
        if(schemaVersion!=1)throw new IllegalArgumentException("不支持的计数规则版本");
        for(double n:new double[]{roiX1,roiY1,roiX2,roiY2,x1,y1,x2,y2})range(n,0,1,"区域和计数线坐标");
        if(roiX2-roiX1<.1||roiY2-roiY1<.1)throw new IllegalArgumentException("识别区域宽高至少为画面的 10%");
        if(x1<roiX1||x1>roiX2||x2<roiX1||x2>roiX2||y1<roiY1||y1>roiY2||y2<roiY1||y2>roiY2)
            throw new IllegalArgumentException("计数线两端必须位于识别区域内");
        if(Math.hypot(x2-x1,y2-y1)<.1)throw new IllegalArgumentException("计数线过短");
        range(confidence,.05,.95,"检测置信度");range(reviewConfidence,confidence,1,"复核置信度");
        range(deadzone,.001,.1,"越线死区");range(stableFrames,1,15,"稳定帧数");
        range(maxGapSeconds,.1,30,"轨迹间隔");range(duplicateWindowSeconds,0,10,"重复预警时间");
        range(duplicateDistance,0,.3,"重复预警距离");
        if((nestingPolicy==null||!Set.of("OUTER","INNER").contains(nestingPolicy)))throw new IllegalArgumentException("嵌套目标策略无效");
        validateLabels(targetLabels,false);validateLabels(emptyLabels,true);
        if(targetLabels.stream().anyMatch(v->emptyLabels.contains(v)))throw new IllegalArgumentException("计数类别与空容器类别不能重叠");
        if(meals==null||meals.size()!=3)throw new IllegalArgumentException("请配置三个餐次");
        Set<String> slots=new HashSet<>();List<int[]> spans=new ArrayList<>();
        for(MealWindow m:meals){
            if(m==null||m.slot()==null||!Set.of("BREAKFAST","LUNCH","DINNER").contains(m.slot())||!slots.add(m.slot()))throw new IllegalArgumentException("餐次无效或重复");
            try{
                if(!m.start().matches("\\d{2}:\\d{2}")||!m.end().matches("\\d{2}:\\d{2}"))throw new IllegalArgumentException();
                int a=LocalTime.parse(m.start()).toSecondOfDay(),b=LocalTime.parse(m.end()).toSecondOfDay();
                if(a>=b)throw new IllegalArgumentException();spans.add(new int[]{a,b});
            }catch(Exception e){throw new IllegalArgumentException("餐次使用 HH:mm；首版餐次不能跨午夜");}
        }
        spans.sort(Comparator.comparingInt(a->a[0]));
        for(int i=1;i<spans.size();i++)if(spans.get(i)[0]<spans.get(i-1)[1])throw new IllegalArgumentException("餐次时间不能重叠");
    }
    private static void validateLabels(List<String> labels,boolean emptyAllowed){
        if(labels==null||labels.size()>30||(!emptyAllowed&&labels.isEmpty()))throw new IllegalArgumentException("请填写 1—30 个计数类别，空容器类别可留空");
        Set<String> seen=new HashSet<>();
        for(String s:labels)if(s==null||s.isBlank()||s.length()>50||!s.equals(s.trim().toLowerCase(Locale.ROOT))||!seen.add(s))
            throw new IllegalArgumentException("类别须去重，使用模型中的小写类别名称");
    }
    private static void range(double n,double low,double high,String name){if(!Double.isFinite(n)||n<low||n>high)throw new IllegalArgumentException(name+"超出允许范围");}
    public MealWindow meal(String slot){return meals.stream().filter(m->m.slot().equals(slot)).findFirst().orElseThrow(()->new IllegalArgumentException("餐次不存在"));}
}
