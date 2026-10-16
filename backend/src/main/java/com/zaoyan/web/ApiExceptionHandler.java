package com.zaoyan.web;

import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import java.util.*;

@RestControllerAdvice
public class ApiExceptionHandler {
    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    ResponseEntity<?> forbidden(org.springframework.security.access.AccessDeniedException e){
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("message","无权执行此操作"));
    }
    @ExceptionHandler({IllegalArgumentException.class,MethodArgumentTypeMismatchException.class,org.springframework.http.converter.HttpMessageNotReadableException.class})
    ResponseEntity<?> badRequest(Exception e){return ResponseEntity.badRequest().body(Map.of("message",e.getMessage()==null?"请求参数错误":e.getMessage()));}
    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<?> validation(MethodArgumentNotValidException e){return ResponseEntity.badRequest().body(Map.of("message","表单校验失败"));}
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    ResponseEntity<?> conflict(Exception e){return ResponseEntity.status(409).body(Map.of("message","记录与现有数据冲突，请刷新后重试"));}
    @ExceptionHandler(org.springframework.dao.PessimisticLockingFailureException.class)
    ResponseEntity<?> locked(Exception e){return ResponseEntity.status(409).body(Map.of("message","该记录正在被另一操作修改，请稍后重试"));}
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    ResponseEntity<?> big(MaxUploadSizeExceededException e){return ResponseEntity.status(413).body(Map.of("message","视频超过 200 MB 限制"));}
}
