package com.zaoyan.service;
import java.util.*;import org.springframework.data.domain.*;
public final class PageViews {
    private PageViews(){}
    public static Pageable request(int page,int size){if(page<0||size<1||size>100)throw new IllegalArgumentException("分页参数无效");return PageRequest.of(page,size,Sort.by(Sort.Order.desc("createdAt"),Sort.Order.desc("id")));}
    public static <T> Map<String,Object> of(Page<T> p){return Map.of("items",p.getContent(),"total",p.getTotalElements(),"pages",p.getTotalPages(),"page",p.getNumber(),"size",p.getSize());}
}
